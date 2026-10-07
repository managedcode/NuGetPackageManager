using System.Text;
using System.Text.Json;
using ManagedCode.NuGet.Core.Features.PackageUpdates;
using Spectre.Console;

namespace ManagedCode.NuGet.Tool;

internal static class CommandLine
{
  private sealed record Options(string Command, string Path, string? Family, string Policy, bool Prerelease,
      IReadOnlyList<Feed> Feeds, bool Yes, bool DryRun, bool Json);
  private sealed record Candidate(string File, string FileLabel, Declaration Declaration, string Target, string UpdateKind);
  private sealed class LoadedFile(string path, string label, string text, byte[] original, Encoding encoding)
  {
    public string Path { get; } = path;
    public string Label { get; } = label;
    public string Text { get; } = text;
    public byte[] Original { get; } = original;
    public Encoding Encoding { get; } = encoding;
  }

  public static async Task<int> RunAsync(string[] args)
  {
    if (args.Contains("--help") || args.Contains("-h")) { PrintHelp(); return 0; }
    if (args.Length == 0) args = ["update"];
    try
    {
      var options = ParseOptions(args);
      return await ExecuteAsync(options);
    }
    catch (Exception error)
    {
      if (args.Contains("--json")) Console.Out.WriteLine(JsonSerializer.Serialize(new { error = error.Message }, JsonOptions));
      else Console.Error.WriteLine($"nuget-manager: {error.Message}");
      return 1;
    }
  }

  private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

  private static Options ParseOptions(string[] args)
  {
    var command = args[0];
    if (command is not ("check" or "update")) throw new ArgumentException("Use 'check' or 'update'. See --help.");
    string? family = null;
    var path = Directory.GetCurrentDirectory();
    var policy = "latest";
    var prerelease = false;
    var yes = false;
    var dryRun = false;
    var json = false;
    var sources = new List<string>();
    for (var index = 1; index < args.Length; index++)
    {
      var option = args[index];
      string Next() => ++index < args.Length ? args[index] : throw new ArgumentException($"{option} requires a value.");
      switch (option)
      {
        case "--family": family = Next(); break;
        case "--path": path = Next(); break;
        case "--policy": policy = Next(); break;
        case "--source": sources.Add(Next()); break;
        case "--prerelease": prerelease = true; break;
        case "--yes": yes = true; break;
        case "--dry-run": dryRun = true; break;
        case "--json": json = true; break;
        default: throw new ArgumentException($"Unknown option {option}.");
      }
    }
    if (policy is not ("latest" or "minor" or "patch")) throw new ArgumentException("Policy must be latest, minor, or patch.");
    if (family is not null && (string.IsNullOrWhiteSpace(family) || family.StartsWith('.') || family.EndsWith('.')))
      throw new ArgumentException("Family must be a package ID prefix with dot boundaries.");
    if (command == "update" && json && !yes && !dryRun) throw new ArgumentException("Use --yes or --dry-run with --json update.");
    if (command == "update" && !yes && !dryRun && Console.IsInputRedirected)
      throw new ArgumentException("Interactive update requires a terminal. Use --yes or --dry-run for automation.");
    if (sources.Count == 0) sources.Add("https://api.nuget.org/v3/index.json");
    var feeds = sources.Select((url, index) => new Feed($"source {index + 1}", NuGetFeeds.ValidateUrl(url).ToString())).ToArray();
    return new Options(command, System.IO.Path.GetFullPath(path), family, policy, prerelease, feeds, yes, dryRun, json);
  }

  private static async Task<int> ExecuteAsync(Options options)
  {
    if (!Directory.Exists(options.Path)) throw new DirectoryNotFoundException($"Workspace does not exist: {options.Path}");
    var files = new List<LoadedFile>();
    var declarations = new List<(LoadedFile File, Declaration Declaration)>();
    var notices = new List<string>();
    foreach (var path in FindPackageFiles(options.Path))
    {
      try
      {
        var file = await LoadAsync(path, options.Path);
        if (file.Text.Length > 1_000_000)
        {
          notices.Add($"{file.Label}: file exceeds the 1 MB scan limit.");
          continue;
        }
        files.Add(file);
        var parsed = PackageDocuments.Parse(file.Text);
        declarations.AddRange(parsed.Declarations.Select(item => (file, item)));
        notices.AddRange(parsed.Ignored.Select(item => $"{file.Label} · {item.PackageId}: {item.Reason}"));
      }
      catch (Exception error) { notices.Add($"{System.IO.Path.GetRelativePath(options.Path, path)}: {error.Message}"); }
    }
    if (declarations.Count == 0 && notices.Count > 0)
      throw new InvalidOperationException("No editable declarations were found. " + string.Join("; ", notices));

    var candidates = new List<Candidate>();
    var failures = new List<string>();
    using var feeds = new NuGetFeeds();
    var versionResults = new Dictionary<string, IReadOnlyList<string>>(StringComparer.OrdinalIgnoreCase);
    var scopedDeclarations = options.Family is null ? declarations : declarations
        .Where(item => PackageVersions.MatchesFamily(item.Declaration.PackageId, options.Family)).ToList();
    var packageIds = scopedDeclarations.Select(item => item.Declaration.PackageId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    using var semaphore = new SemaphoreSlim(6);
    await Task.WhenAll(packageIds.Select(async id =>
    {
      await semaphore.WaitAsync();
      try
      {
        var versions = await feeds.GetVersionsAsync(id, options.Feeds);
        lock (versionResults) versionResults[id] = versions;
      }
      catch (Exception error) { lock (failures) failures.Add($"{id}: {error.Message}"); }
      finally { semaphore.Release(); }
    }));
    foreach (var (file, declaration) in scopedDeclarations)
    {
      if (!versionResults.TryGetValue(declaration.PackageId, out var versions)) continue;
      var result = PackageVersions.Resolve(declaration.Version, versions, options.Policy, options.Prerelease);
      if (result.Target is not null) candidates.Add(new Candidate(file.Path, file.Label, declaration, result.Target, result.UpdateKind!));
    }
    var selected = SelectCandidates(options, candidates);
    if (!options.Json || options.Command == "check" || options.DryRun || selected.Count == 0 || failures.Count > 0)
      PrintResult(options, candidates, selected, failures, notices);
    if (options.Command == "check" || options.DryRun || selected.Count == 0 || failures.Count > 0) return failures.Count == 0 ? 0 : 2;
    if (!options.Yes && !AnsiConsole.Confirm($"Apply {selected.Count} reviewed update(s) across {selected.Select(item => item.File).Distinct().Count()} file(s)?", false)) return 0;
    await ApplyAsync(files, selected);
    if (!options.Json) AnsiConsole.MarkupLine($"[green]Applied {selected.Count} package update(s). Restore and test your solution.[/]");
    else PrintResult(options, candidates, selected, failures, notices, selected.Count);
    return 0;
  }

  private static IReadOnlyList<Candidate> SelectCandidates(Options options, List<Candidate> candidates)
  {
    if (options.Family is not null)
      return candidates.Where(item => PackageVersions.MatchesFamily(item.Declaration.PackageId, options.Family)).ToArray();
    if (options.Command == "check" || options.Yes || options.DryRun) return candidates;
    var groups = candidates.SelectMany(item => item.Declaration.Families)
        .GroupBy(name => name, StringComparer.OrdinalIgnoreCase)
        .Where(group => !group.Key.Contains('.') || group.Count() >= 2)
        .OrderBy(group => group.Key).Select(group => group.Key).ToArray();
    if (groups.Length == 0) return [];
    var chosen = AnsiConsole.Prompt(new MultiSelectionPrompt<string>()
        .Title("Select package families to update together")
        .NotRequired()
        .PageSize(16)
        .AddChoices(groups));
    return candidates.Where(item => chosen.Any(family => PackageVersions.MatchesFamily(item.Declaration.PackageId, family))).ToArray();
  }

  private static void PrintResult(Options options, List<Candidate> candidates, IReadOnlyList<Candidate> selected,
      List<string> failures, List<string> notices, int? applied = null)
  {
    if (options.Json)
    {
      Console.Out.WriteLine(JsonSerializer.Serialize(new
      {
        command = options.Command,
        updateCount = candidates.Count,
        selectedCount = selected.Count,
        changes = selected.Select(item => new
        {
          item.Declaration.PackageId,
          from = item.Declaration.Version,
          to = item.Target,
          file = item.FileLabel,
          condition = item.Declaration.Condition,
          updateKind = item.UpdateKind
        }),
        failures,
        notices,
        applied
      }, JsonOptions));
      return;
    }
    var table = new Table().AddColumn("Family").AddColumn("Package").AddColumn("Current").AddColumn("Target").AddColumn("File");
    foreach (var item in selected)
      table.AddRow(Markup.Escape(item.Declaration.Group), Markup.Escape(item.Declaration.PackageId),
          Markup.Escape(item.Declaration.Version), Markup.Escape(item.Target), Markup.Escape(item.FileLabel));
    if (selected.Count > 0) AnsiConsole.Write(table);
    else AnsiConsole.MarkupLine("[yellow]No matching package updates.[/]");
    foreach (var failure in failures) AnsiConsole.MarkupLine($"[red]{Markup.Escape(failure)}[/]");
    foreach (var notice in notices) AnsiConsole.MarkupLine($"[yellow]{Markup.Escape(notice)}[/]");
    if (options.DryRun) AnsiConsole.MarkupLine("[yellow]Dry run: no files were changed.[/]");
  }

  private static async Task ApplyAsync(List<LoadedFile> files, IReadOnlyList<Candidate> selected)
  {
    // Verify every discovered document before any write, including files without selected updates.
    foreach (var file in files)
      if (!File.ReadAllBytes(file.Path).AsSpan().SequenceEqual(file.Original))
        throw new InvalidOperationException($"{file.Label} changed after discovery. Refresh and review again.");
    var writes = selected.GroupBy(item => item.File).Select(group =>
    {
      var file = files.Single(item => item.Path == group.Key);
      var changes = group.Select(item => new PlannedChange(item.Declaration.Key, item.Declaration.PackageId,
              item.Declaration.Version, item.Target, file.Path, file.Label, item.Declaration.Start,
              item.Declaration.End, item.Declaration.Condition));
      var updated = PackageDocuments.Apply(file.Text, changes);
      return (File: file, Bytes: Encode(updated, file.Encoding));
    }).ToArray();
    var completed = new List<(LoadedFile File, byte[] Written)>();
    try
    {
      foreach (var (file, bytes) in writes)
      {
        if (!File.ReadAllBytes(file.Path).AsSpan().SequenceEqual(file.Original))
          throw new InvalidOperationException($"{file.Label} changed during apply. No further files were changed.");
        await WriteAtomicallyAsync(file.Path, bytes);
        completed.Add((file, bytes));
      }
    }
    catch (Exception error)
    {
      var rollbackFailures = new List<string>();
      foreach (var (file, written) in completed)
      {
        try
        {
          if (!File.ReadAllBytes(file.Path).AsSpan().SequenceEqual(written))
            throw new IOException("File changed after our write; manual repair required.");
          await WriteAtomicallyAsync(file.Path, file.Original);
        }
        catch (Exception rollback) { rollbackFailures.Add($"{file.Label}: {rollback.Message}"); }
      }
      throw new IOException(rollbackFailures.Count == 0
          ? $"Update failed; previously changed files were restored. {error.Message}"
          : $"Update failed and rollback needs manual repair: {string.Join("; ", rollbackFailures)}", error);
    }
  }

  private static async Task WriteAtomicallyAsync(string path, byte[] bytes)
  {
    var temp = path + ".nuget-manager-" + Guid.NewGuid().ToString("N") + ".tmp";
    var mode = !OperatingSystem.IsWindows() && File.Exists(path) ? File.GetUnixFileMode(path) : (UnixFileMode?)null;
    try
    {
      await File.WriteAllBytesAsync(temp, bytes);
      if (!OperatingSystem.IsWindows() && mode is not null) File.SetUnixFileMode(temp, mode.Value);
      File.Move(temp, path, true);
    }
    finally { if (File.Exists(temp)) File.Delete(temp); }
  }

  private static byte[] Encode(string text, Encoding encoding)
  {
    var body = encoding.GetBytes(text);
    var preamble = encoding.GetPreamble();
    return [.. preamble, .. body];
  }

  private static async Task<LoadedFile> LoadAsync(string path, string root)
  {
    if (new FileInfo(path).Length > 4_000_000)
      throw new InvalidOperationException("file exceeds the 4 MB byte scan limit.");
    var original = await File.ReadAllBytesAsync(path);
    using var stream = new MemoryStream(original);
    using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
    var text = await reader.ReadToEndAsync();
    var encoding = reader.CurrentEncoding;
    if (encoding.CodePage == Encoding.UTF8.CodePage)
      encoding = new UTF8Encoding(original.AsSpan().StartsWith(new byte[] { 0xEF, 0xBB, 0xBF }));
    else if (encoding.CodePage == Encoding.Unicode.CodePage) encoding = new UnicodeEncoding(false, true);
    else if (encoding.CodePage == Encoding.BigEndianUnicode.CodePage) encoding = new UnicodeEncoding(true, true);
    return new LoadedFile(path, System.IO.Path.GetRelativePath(root, path), text, original, encoding);
  }

  private static IEnumerable<string> FindPackageFiles(string root)
  {
    var pending = new Stack<string>();
    pending.Push(root);
    while (pending.Count > 0)
    {
      var folder = pending.Pop();
      foreach (var subdirectory in Directory.EnumerateDirectories(folder))
        if (!IsReparsePoint(subdirectory) && !new[] { "bin", "obj", "node_modules", ".git", "packages" }.Contains(System.IO.Path.GetFileName(subdirectory), StringComparer.OrdinalIgnoreCase))
          pending.Push(subdirectory);
      foreach (var file in Directory.EnumerateFiles(folder))
      {
        if (IsReparsePoint(file)) continue;
        var name = System.IO.Path.GetFileName(file);
        if (name.Equals("Directory.Packages.props", StringComparison.OrdinalIgnoreCase) ||
            new[] { ".csproj", ".fsproj", ".vbproj" }.Contains(System.IO.Path.GetExtension(file), StringComparer.OrdinalIgnoreCase))
          yield return file;
      }
    }
  }

  private static bool IsReparsePoint(string path)
  {
    try { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0; }
    catch (IOException) { return true; }
    catch (UnauthorizedAccessException) { return true; }
  }

  private static void PrintHelp() => Console.WriteLine("""
        nuget-manager check|update [options]

        Check listed NuGet updates or review and apply selected package families.
        update without --yes opens an interactive family selection and review.

          --family <prefix>       Select exact package ID or dotted descendants
          --policy latest|minor|patch   Limit target versions (default: latest)
          --prerelease            Include prerelease versions
          --source <V3 URL>       Add a NuGet V3 service index (repeatable)
          --path <directory>      Workspace root (default: current directory)
          --yes                   Apply without confirmation
          --dry-run               Show proposed changes without writing
          --json                  Write machine-readable results
          --help                  Show this help
        """);
}
