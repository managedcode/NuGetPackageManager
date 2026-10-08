using System.Text.RegularExpressions;
using System.Xml;

namespace ManagedCode.NuGet.Core.Features.PackageUpdates;

public static partial class PackageDocuments
{
  private sealed record SpanValue(string Value, int Start, int End, string? Condition);
  private sealed class Frame(string name, int start, int openEnd, Dictionary<string, string> attributes, string? condition, bool isProjectSdk)
  {
    public string Name { get; } = name;
    public bool IsProjectSdk { get; } = isProjectSdk;
    public int Start { get; } = start;
    public int OpenEnd { get; } = openEnd;
    public Dictionary<string, string> Attributes { get; } = attributes;
    public string? Condition { get; } = condition;
    public List<SpanValue> Versions { get; } = [];
  }

  [GeneratedRegex(@"\s([\w:.-]+)\s*=\s*([""'])([\s\S]*?)\2")]
  private static partial Regex AttributePattern();

  [GeneratedRegex(@"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")]
  private static partial Regex PackageIdPattern();

  public static ParseResult Parse(string text)
  {
    ValidateXml(text);
    var declarations = new List<Declaration>();
    var ignored = new List<IgnoredDeclaration>();
    var stack = new Stack<Frame>();
    var index = 0;
    while ((index = text.IndexOf('<', index)) >= 0)
    {
      if (text.AsSpan(index).StartsWith("<!--", StringComparison.Ordinal))
      {
        index = Skip(text, index, "-->", 4);
        continue;
      }
      if (text.AsSpan(index).StartsWith("<![CDATA[", StringComparison.Ordinal))
      {
        index = Skip(text, index, "]]>", 9);
        continue;
      }
      if (text.AsSpan(index).StartsWith("<?", StringComparison.Ordinal))
      {
        index = Skip(text, index, "?>", 2);
        continue;
      }
      var end = FindTagEnd(text, index);
      if (text[index + 1] == '/')
      {
        Finish(text, stack.Pop(), index, stack, declarations, ignored);
      }
      else
      {
        var nameEnd = index + 1;
        while (nameEnd < end && !char.IsWhiteSpace(text[nameEnd]) && text[nameEnd] is not ('/' or '>')) nameEnd++;
        var name = text[(index + 1)..nameEnd].Split(':').Last();
        var raw = text[index..(end + 1)];
        var attributes = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (Match match in AttributePattern().Matches(raw)) attributes[match.Groups[1].Value] = match.Groups[3].Value;
        var conditions = stack.Reverse().Select(frame => frame.Attributes.GetValueOrDefault("Condition"))
            .Append(attributes.GetValueOrDefault("Condition")).Where(value => !string.IsNullOrEmpty(value));
        var condition = string.Join(" AND ", conditions);
        var isProjectSdk = name == "Sdk" && stack.Count == 1 && stack.Peek().Name == "Project";
        var frame = new Frame(name, index, end + 1, attributes, condition.Length == 0 ? null : condition, isProjectSdk);
        if (name is "PackageVersion" or "PackageReference" || frame.IsProjectSdk)
        {
          foreach (Match match in AttributePattern().Matches(raw))
          {
            if (match.Groups[1].Value != "Version") continue;
            var value = match.Groups[3];
            frame.Versions.Add(new SpanValue(value.Value, index + value.Index, index + value.Index + value.Length, frame.Condition));
          }
        }
        stack.Push(frame);
        if (text.AsSpan(index, end - index).TrimEnd().EndsWith("/", StringComparison.Ordinal))
          Finish(text, stack.Pop(), end, stack, declarations, ignored);
      }
      index = end + 1;
    }
    return new ParseResult(declarations, ignored);
  }

  public static string Apply(string text, IEnumerable<PlannedChange> changes)
  {
    var ordered = changes.OrderByDescending(change => change.Start).ToArray();
    var declarations = Parse(text).Declarations;
    var previous = text.Length + 1;
    foreach (var change in ordered)
    {
      if (!PackageVersions.TryParse(change.To, out _) || change.Start < 0 || change.End < change.Start ||
          change.End > text.Length || change.End > previous ||
          !string.Equals(text[change.Start..change.End], change.From, StringComparison.Ordinal) ||
          !declarations.Any(item => item.Start == change.Start && item.End == change.End &&
              item.PackageId.Equals(change.PackageId, StringComparison.OrdinalIgnoreCase)))
        throw new InvalidOperationException("Package file changed. Refresh and review the selection again.");
      text = text[..change.Start] + change.To + text[change.End..];
      previous = change.Start;
    }
    Parse(text);
    return text;
  }

  private static void ValidateXml(string text)
  {
    try
    {
      using var reader = XmlReader.Create(new StringReader(text.StartsWith('\uFEFF') ? text[1..] : text), new XmlReaderSettings
      {
        DtdProcessing = DtdProcessing.Prohibit,
        XmlResolver = null,
        ConformanceLevel = ConformanceLevel.Document
      });
      while (reader.Read()) { }
    }
    catch (XmlException error) { throw new InvalidOperationException($"Invalid MSBuild XML: {error.Message}", error); }
  }

  private static int Skip(string text, int start, string closing, int openingLength)
  {
    var end = text.IndexOf(closing, start + openingLength, StringComparison.Ordinal);
    return end < 0 ? text.Length : end + closing.Length;
  }

  private static int FindTagEnd(string text, int start)
  {
    char quote = '\0';
    for (var index = start + 1; index < text.Length; index++)
    {
      var character = text[index];
      if (quote != '\0') { if (character == quote) quote = '\0'; }
      else if (character is '\'' or '"') quote = character;
      else if (character == '>') return index;
    }
    throw new InvalidOperationException("Invalid MSBuild XML: unclosed tag.");
  }

  private static void Finish(string text, Frame frame, int closeStart, Stack<Frame> stack, List<Declaration> declarations, List<IgnoredDeclaration> ignored)
  {
    var parent = stack.TryPeek(out var containing) ? containing : null;
    if (frame.Name == "Version" && parent?.Name is ("PackageVersion" or "PackageReference"))
    {
      var raw = closeStart >= frame.OpenEnd ? text[frame.OpenEnd..closeStart] : string.Empty;
      var value = raw.Trim();
      var start = frame.OpenEnd + (value.Length == 0 ? 0 : raw.IndexOf(value, StringComparison.Ordinal));
      parent.Versions.Add(new SpanValue(value, start, start + value.Length, frame.Condition));
    }
    if (frame.Name is not ("PackageVersion" or "PackageReference") && !frame.IsProjectSdk) return;
    var packageId = frame.IsProjectSdk ? frame.Attributes.GetValueOrDefault("Name") :
        frame.Attributes.GetValueOrDefault("Include") ?? frame.Attributes.GetValueOrDefault("Update");
    if (packageId is null || (packageId.Length == 0 && !frame.IsProjectSdk)) return;
    if (frame.Versions.Count == 0 && frame.Name == "PackageVersion")
      ignored.Add(new IgnoredDeclaration(packageId, "No literal Version declaration"));
    foreach (var version in frame.Versions)
    {
      if (!PackageIdPattern().IsMatch(packageId) || !PackageVersions.TryParse(version.Value, out _))
      {
        ignored.Add(new IgnoredDeclaration(packageId, "Property, range, wildcard or unsupported version; edit its owning declaration"));
        continue;
      }
      declarations.Add(new Declaration($"{frame.Start}:{version.Start}:{packageId}", packageId, version.Value,
          version.Start, version.End, frame.Name, version.Condition, PackageVersions.FirstSegment(packageId), PackageVersions.Families(packageId)));
    }
  }
}
