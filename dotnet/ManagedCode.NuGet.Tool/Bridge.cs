using System.Text.Json;
using ManagedCode.NuGet.Core.Features.PackageUpdates;

namespace ManagedCode.NuGet.Tool;

internal static class Bridge
{
  private const int RequestLimit = 5_000_000;
  private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
  {
    DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
  };

  public static async Task<int> RunAsync()
  {
    try
    {
      using var input = new MemoryStream();
      using var standardInput = Console.OpenStandardInput();
      var buffer = new byte[8192];
      int read;
      while ((read = await standardInput.ReadAsync(buffer)) > 0)
      {
        if (input.Length + read > RequestLimit) throw new InvalidOperationException("Bridge request exceeds the size limit.");
        input.Write(buffer, 0, read);
      }
      input.Position = 0;
      using var request = await JsonDocument.ParseAsync(input);
      var root = request.RootElement;
      if (!root.TryGetProperty("command", out var command) || command.ValueKind != JsonValueKind.String)
        throw new ArgumentException("Bridge command is required.");
      object result = command.GetString() switch
      {
        "parse" => PackageDocuments.Parse(RequiredString(root, "text")),
        "resolve" => PackageVersions.Resolve(RequiredString(root, "current"), RequiredStrings(root, "versions"),
            OptionalString(root, "policy") ?? "latest", OptionalBool(root, "prerelease")),
        "apply" => new { text = PackageDocuments.Apply(RequiredString(root, "text"), RequiredChanges(root)) },
        "versions" => new { versions = await VersionsAsync(root) },
        _ => throw new ArgumentException("Unknown bridge command.")
      };
      Console.Out.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
      return 0;
    }
    catch (Exception error)
    {
      Console.Out.WriteLine(JsonSerializer.Serialize(new { error = error.Message }, JsonOptions));
      return 1;
    }
  }

  private static async Task<IReadOnlyList<string>> VersionsAsync(JsonElement root)
  {
    var packageId = RequiredString(root, "packageId");
    if (!root.TryGetProperty("feeds", out var feedsElement) || feedsElement.ValueKind != JsonValueKind.Array)
      throw new ArgumentException("feeds must be an array.");
    var feeds = feedsElement.EnumerateArray().Select(item => new Feed(RequiredString(item, "name"), RequiredString(item, "url"))).ToArray();
    using var client = new NuGetFeeds();
    return await client.GetVersionsAsync(packageId, feeds);
  }

  private static PlannedChange[] RequiredChanges(JsonElement root)
  {
    if (!root.TryGetProperty("changes", out var values) || values.ValueKind != JsonValueKind.Array)
      throw new ArgumentException("changes must be an array.");
    return values.EnumerateArray().Select(item => new PlannedChange(
        OptionalString(item, "key") ?? "", RequiredString(item, "packageId"), RequiredString(item, "from"),
        RequiredString(item, "to"), OptionalString(item, "file") ?? "", OptionalString(item, "fileLabel") ?? "",
        RequiredInt(item, "start"), RequiredInt(item, "end"), OptionalString(item, "condition"))).ToArray();
  }

  private static string[] RequiredStrings(JsonElement root, string name)
  {
    if (!root.TryGetProperty(name, out var values) || values.ValueKind != JsonValueKind.Array ||
        values.EnumerateArray().Any(value => value.ValueKind != JsonValueKind.String))
      throw new ArgumentException($"{name} must be an array of strings.");
    return values.EnumerateArray().Select(value => value.GetString()!).ToArray();
  }

  private static string RequiredString(JsonElement root, string name) =>
      root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
          ? value.GetString()!
          : throw new ArgumentException($"{name} must be a string.");

  private static string? OptionalString(JsonElement root, string name) =>
      root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

  private static bool OptionalBool(JsonElement root, string name) =>
      root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

  private static int RequiredInt(JsonElement root, string name) =>
      root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var result)
          ? result : throw new ArgumentException($"{name} must be an integer.");
}
