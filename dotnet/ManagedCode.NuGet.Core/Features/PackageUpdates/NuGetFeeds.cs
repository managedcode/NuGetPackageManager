using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ManagedCode.NuGet.Core.Features.PackageUpdates;

public sealed class NuGetFeeds : IDisposable
{
  private const int ResponseLimit = 5_000_000;
  private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);
  private static readonly string[] RegistrationTypes =
  [
      "RegistrationsBaseUrl/3.6.0", "RegistrationsBaseUrl/3.4.0", "RegistrationsBaseUrl/3.0.0-rc",
        "RegistrationsBaseUrl/3.0.0-beta", "RegistrationsBaseUrl"
  ];
  private readonly HttpClient _http = new(new HttpClientHandler { AllowAutoRedirect = false });

  public async Task<IReadOnlyList<string>> GetVersionsAsync(string packageId, IReadOnlyList<Feed> feeds, CancellationToken cancellationToken = default)
  {
    if (!Regex.IsMatch(packageId, @"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")) throw new ArgumentException("Invalid package ID.");
    if (feeds.Count == 0) throw new ArgumentException("Configure at least one NuGet V3 feed.");
    var versions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var feed in feeds)
    {
      if (string.IsNullOrWhiteSpace(feed.Name)) throw new ArgumentException("Feed name is required.");
      try
      {
        var (content, registration) = await GetResourcesAsync(feed.Url, cancellationToken);
        var suffix = packageId.ToLowerInvariant() + "/index.json";
        using var flat = await RequestJsonAsync(new Uri(content, suffix), cancellationToken);
        if (!flat.RootElement.TryGetProperty("versions", out var flatVersions) || flatVersions.ValueKind != JsonValueKind.Array)
          throw new InvalidOperationException("Invalid version response.");
        var candidates = flatVersions.EnumerateArray().Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : null).ToArray();
        if (candidates.Any(item => !PackageVersions.TryParse(item, out _))) throw new InvalidOperationException("Invalid version response.");
        if (candidates.Length == 0) continue;
        var listed = await GetListedAsync(new Uri(registration, suffix), packageId, cancellationToken);
        foreach (var version in candidates)
          if (listed.Contains(VersionKey(version!))) versions.Add(version!);
      }
      catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
      catch (Exception error) { throw new InvalidOperationException($"{feed.Name}: {error.Message}", error); }
    }
    if (versions.Count == 0) throw new InvalidOperationException("No listed package versions were found in the configured feeds.");
    return versions.OrderBy(PackageVersions.Parse, global::NuGet.Versioning.VersionComparer.VersionRelease).ToArray();
  }

  public static Uri ValidateUrl(string value)
  {
    if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || !string.IsNullOrEmpty(uri.UserInfo) ||
        !(uri.Scheme == Uri.UriSchemeHttps || (uri.Scheme == Uri.UriSchemeHttp &&
          (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || IPAddress.IsLoopback(IPAddress.TryParse(uri.Host, out var address) ? address : IPAddress.None)))))
      throw new ArgumentException("Feeds require HTTPS, or HTTP on localhost. Do not put credentials in a feed URL.");
    return uri;
  }

  private async Task<(Uri Content, Uri Registration)> GetResourcesAsync(string indexUrl, CancellationToken token)
  {
    using var index = await RequestJsonAsync(ValidateUrl(indexUrl), token);
    if (!index.RootElement.TryGetProperty("resources", out var resources) || resources.ValueKind != JsonValueKind.Array)
      throw new InvalidOperationException("Invalid NuGet V3 service index.");
    string? content = null;
    string? registration = null;
    var registrationPriority = int.MaxValue;
    foreach (var item in resources.EnumerateArray())
    {
      if (!item.TryGetProperty("@id", out var id) || id.ValueKind != JsonValueKind.String ||
          !item.TryGetProperty("@type", out var type)) continue;
      if (HasType(type, "PackageBaseAddress/3.0.0")) content ??= id.GetString();
      for (var priority = 0; priority < RegistrationTypes.Length; priority++)
      {
        if (!HasType(type, RegistrationTypes[priority]) || priority >= registrationPriority) continue;
        registration = id.GetString();
        registrationPriority = priority;
      }
    }
    if (content is null) throw new InvalidOperationException("Feed does not expose PackageBaseAddress.");
    if (registration is null) throw new InvalidOperationException("Feed does not expose registration metadata for listed versions.");
    return (EnsureDirectory(ValidateUrl(content)), EnsureDirectory(ValidateUrl(registration)));
  }

  private static bool HasType(JsonElement element, string value) => element.ValueKind switch
  {
    JsonValueKind.String => element.GetString() == value,
    JsonValueKind.Array => element.EnumerateArray().Any(item => item.ValueKind == JsonValueKind.String && item.GetString() == value),
    _ => false
  };

  private async Task<HashSet<string>> GetListedAsync(Uri url, string packageId, CancellationToken token)
  {
    using var index = await RequestJsonAsync(url, token);
    if (!index.RootElement.TryGetProperty("items", out var pages) || pages.ValueKind != JsonValueKind.Array || pages.GetArrayLength() > 200)
      throw new InvalidOperationException("Invalid registration index or too many pages.");
    var listed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var page in pages.EnumerateArray())
    {
      JsonDocument? loaded = null;
      try
      {
        var source = page;
        if (!page.TryGetProperty("items", out _))
        {
          if (!page.TryGetProperty("@id", out var pageId) || pageId.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException("Invalid registration page.");
          loaded = await RequestJsonAsync(ValidateUrl(pageId.GetString()!), token);
          source = loaded.RootElement;
        }
        if (!source.TryGetProperty("items", out var leaves) || leaves.ValueKind != JsonValueKind.Array)
          throw new InvalidOperationException("Invalid registration page.");
        foreach (var leaf in leaves.EnumerateArray())
        {
          if (!leaf.TryGetProperty("catalogEntry", out var entry) || entry.ValueKind != JsonValueKind.Object ||
              !entry.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String ||
              !packageId.Equals(id.GetString(), StringComparison.OrdinalIgnoreCase) ||
              !entry.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.String ||
              !PackageVersions.TryParse(version.GetString(), out _))
            throw new InvalidOperationException("Invalid registration catalog entry.");
          if (entry.TryGetProperty("listed", out var status) && status.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new InvalidOperationException("Invalid registration catalog entry.");
          var unlisted = (entry.TryGetProperty("listed", out status) && status.ValueKind == JsonValueKind.False) ||
              (entry.TryGetProperty("published", out var published) && published.ValueKind == JsonValueKind.String &&
               published.GetString()!.StartsWith("1900-", StringComparison.Ordinal));
          if (!unlisted) listed.Add(VersionKey(version.GetString()!));
        }
      }
      finally { loaded?.Dispose(); }
    }
    return listed;
  }

  private async Task<JsonDocument> RequestJsonAsync(Uri initial, CancellationToken token)
  {
    ValidateUrl(initial.ToString());
    for (var attempt = 0; attempt < 3; attempt++)
    {
      token.ThrowIfCancellationRequested();
      using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
      timeout.CancelAfter(RequestTimeout);
      var destination = initial;
      for (var redirects = 0; redirects <= 5; redirects++)
      {
        ValidateUrl(destination.ToString());
        using var response = await _http.GetAsync(destination, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if ((int)response.StatusCode is 301 or 302 or 303 or 307 or 308)
        {
          if (response.Headers.Location is null) throw new InvalidOperationException("Feed returned an invalid redirect.");
          destination = new Uri(destination, response.Headers.Location);
          continue;
        }
        if (response.StatusCode == HttpStatusCode.NotFound)
          return JsonDocument.Parse("{\"versions\":[]}");
        if (response.StatusCode is HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable && attempt < 2)
        {
          await Task.Delay(TimeSpan.FromMilliseconds((attempt + 1) * 750), token);
          break;
        }
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
          throw new InvalidOperationException("Feed requires authentication. Authenticated feeds are not supported by this version.");
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Feed returned HTTP {(int)response.StatusCode}.");
        if (response.Content.Headers.ContentLength > ResponseLimit) throw new InvalidOperationException("Feed response exceeds the size limit.");
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var memory = new MemoryStream();
        var buffer = new byte[8192];
        int read;
        while ((read = await stream.ReadAsync(buffer, timeout.Token)) > 0)
        {
          if (memory.Length + read > ResponseLimit) throw new InvalidOperationException("Feed response exceeds the size limit.");
          memory.Write(buffer, 0, read);
        }
        memory.Position = 0;
        return await JsonDocument.ParseAsync(memory, cancellationToken: timeout.Token);
      }
      if (attempt == 2) throw new InvalidOperationException("Feed redirected too many times.");
    }
    throw new InvalidOperationException("Feed is unavailable.");
  }

  private static string VersionKey(string value) => PackageVersions.Parse(value).ToNormalizedString().Split('+')[0].ToLowerInvariant();
  private static Uri EnsureDirectory(Uri value) => new(value.ToString().TrimEnd('/') + '/');
  public void Dispose() => _http.Dispose();
}
