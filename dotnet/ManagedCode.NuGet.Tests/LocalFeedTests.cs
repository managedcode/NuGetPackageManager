using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using ManagedCode.NuGet.Core.Features.PackageUpdates;
using Xunit;

namespace ManagedCode.NuGet.Tests;

public sealed class LocalFeedTests
{
  [Fact]
  public async Task FeedReturnsOnlyListedRegistrationVersions()
  {
    await using var feed = new LocalFeed();
    using var client = new NuGetFeeds();
    var versions = await client.GetVersionsAsync("Microsoft.Orleans.Core", [new Feed("local", feed.IndexUrl)], TestContext.Current.CancellationToken);
    Assert.Equal(["1.0.0", "1.1.0"], versions);
  }

  [Theory]
  [InlineData("gzip")]
  [InlineData("deflate")]
  [InlineData("br")]
  public async Task CompressedFeedReturnsOnlyListedRegistrationVersions(string encoding)
  {
    await using var feed = new LocalFeed(contentEncoding: encoding);
    using var client = new NuGetFeeds();
    var versions = await client.GetVersionsAsync("Microsoft.Orleans.Core", [new Feed("local", feed.IndexUrl)], TestContext.Current.CancellationToken);
    Assert.Equal(["1.0.0", "1.1.0"], versions);
  }

  [Fact]
  public async Task InvalidCompressedFeedFailsInsteadOfAppearingCurrent()
  {
    await using var feed = new LocalFeed(contentEncoding: "gzip", malformedCompression: true);
    using var client = new NuGetFeeds();
    var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
        client.GetVersionsAsync("Microsoft.Orleans.Core", [new Feed("local", feed.IndexUrl)], TestContext.Current.CancellationToken));
    Assert.StartsWith("local:", error.Message);
  }

  [Fact]
  public async Task DecompressedFeedResponseStillHonorsSizeLimit()
  {
    await using var feed = new LocalFeed(contentEncoding: "gzip", oversizedDecoded: true);
    using var client = new NuGetFeeds();
    var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
        client.GetVersionsAsync("Microsoft.Orleans.Core", [new Feed("local", feed.IndexUrl)], TestContext.Current.CancellationToken));
    Assert.Contains("size limit", error.Message);
  }

  [Fact]
  public async Task FeedFailureIsNotReportedAsCurrent()
  {
    await using var feed = new LocalFeed(failFlat: true);
    using var client = new NuGetFeeds();
    var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
        client.GetVersionsAsync("Microsoft.Orleans.Core", [new Feed("local", feed.IndexUrl)], TestContext.Current.CancellationToken));
    Assert.Contains("503", error.Message);
  }

  [Fact]
  public async Task CliDryRunSelectsDottedFamilyWithoutEditing()
  {
    await using var feed = new LocalFeed();
    var folder = CreateWorkspace();
    try
    {
      var project = Path.Combine(folder, "Example.csproj");
      var original = "<Project><ItemGroup><PackageReference Include='Microsoft.Orleans.Core' Version='1.0.0'/>" +
                     "<PackageReference Include='Microsoft.OrleansExtra' Version='1.0.0'/></ItemGroup></Project>";
      await File.WriteAllTextAsync(project, original, TestContext.Current.CancellationToken);
      var result = await RunToolAsync("update", "--path", folder, "--family", "Microsoft.Orleans", "--source", feed.IndexUrl,
          "--dry-run", "--json");
      Assert.Equal(0, result.ExitCode);
      using var json = JsonDocument.Parse(result.Output);
      Assert.Equal(1, json.RootElement.GetProperty("selectedCount").GetInt32());
      Assert.Equal(original, await File.ReadAllTextAsync(project, TestContext.Current.CancellationToken));
    }
    finally { Directory.Delete(folder, true); }
  }

  [Fact]
  public async Task CliRejectsAnyChangedDocumentBeforeWriting()
  {
    var folder = CreateWorkspace();
    var project = Path.Combine(folder, "Example.csproj");
    var other = Path.Combine(folder, "Other.csproj");
    await File.WriteAllTextAsync(project, "<Project><ItemGroup><PackageReference Include='Microsoft.Orleans.Core' Version='1.0.0'/></ItemGroup></Project>", TestContext.Current.CancellationToken);
    await File.WriteAllTextAsync(other, "<Project><!-- original --></Project>", TestContext.Current.CancellationToken);
    await using var feed = new LocalFeed(onFlat: () => File.WriteAllText(other, "<Project><!-- changed --></Project>"));
    try
    {
      var result = await RunToolAsync("update", "--path", folder, "--family", "Microsoft.Orleans", "--source", feed.IndexUrl,
          "--yes", "--json");
      Assert.Equal(1, result.ExitCode);
      Assert.Contains("changed after discovery", result.Output);
      Assert.Contains("Version='1.0.0'", await File.ReadAllTextAsync(project, TestContext.Current.CancellationToken));
    }
    finally { Directory.Delete(folder, true); }
  }

  [Fact]
  public async Task CliAppliesReviewedVersionPreservingBomAndCrlf()
  {
    await using var feed = new LocalFeed();
    var folder = CreateWorkspace();
    try
    {
      var project = Path.Combine(folder, "Example.csproj");
      var original = "<Project>\r\n<!-- keep -->\r\n<PackageReference Include='Microsoft.Orleans.Core' Version='1.0.0'/>\r\n</Project>";
      await File.WriteAllTextAsync(project, original, new UTF8Encoding(true), TestContext.Current.CancellationToken);
      var result = await RunToolAsync("update", "--path", folder, "--family", "Microsoft.Orleans", "--source", feed.IndexUrl,
        "--yes", "--json");
      Assert.Equal(0, result.ExitCode);
      using var json = JsonDocument.Parse(result.Output);
      Assert.Equal(1, json.RootElement.GetProperty("applied").GetInt32());
      var bytes = await File.ReadAllBytesAsync(project, TestContext.Current.CancellationToken);
      Assert.True(bytes.AsSpan().StartsWith(new byte[] { 0xEF, 0xBB, 0xBF }));
      Assert.Equal(original.Replace("1.0.0", "1.1.0", StringComparison.Ordinal), Encoding.UTF8.GetString(bytes[3..]));
    }
    finally { Directory.Delete(folder, true); }
  }

  [Theory]
  [InlineData(true)]
  [InlineData(false)]
  public async Task CliReviewsAndAppliesAspireSdkAndLibrariesUsingTheirOwnVersions(bool dryRun)
  {
    await using var feed = new LocalFeed(packageVersions: new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
    {
      ["Aspire.AppHost.Sdk"] = ["13.6.0", "13.6.1", "14.0.0"],
      ["Aspire.Hosting"] = ["13.6.0", "13.6.2", "14.0.0"],
      ["Aspire.Hosting.Redis"] = ["13.5.0", "13.5.1", "14.0.0"],
      ["AspireExtra"] = ["13.6.0", "13.7.0", "14.0.0"]
    });
    var folder = CreateWorkspace();
    try
    {
      var project = Path.Combine(folder, "AppHost.csproj");
      var library = Path.Combine(folder, "Library.csproj");
      var original = "<Project>\r\n<!-- 😀 keep -->\r\n<Sdk Name='Microsoft.NET.Sdk'/>\r\n" +
        "<Sdk Name='Aspire.AppHost.Sdk' Version='13.6.0'/>\r\n<ItemGroup>" +
        "<PackageReference Include=\"Aspire.Hosting\" Version=\"13.6.0\"/>" +
        "<PackageReference Include='AspireExtra' Version='13.6.0'/></ItemGroup>\r\n</Project>";
      var libraryOriginal = "<Project><ItemGroup><PackageReference Include='Aspire.Hosting.Redis' Version='13.5.0'/></ItemGroup></Project>";
      await File.WriteAllTextAsync(project, original, new UTF8Encoding(true), TestContext.Current.CancellationToken);
      await File.WriteAllTextAsync(library, libraryOriginal, TestContext.Current.CancellationToken);
      var result = await RunToolAsync("update", "--path", folder, "--family", "Aspire", "--source", feed.IndexUrl,
        dryRun ? "--dry-run" : "--yes", "--json");
      Assert.Equal(0, result.ExitCode);
      using var json = JsonDocument.Parse(result.Output);
      Assert.Equal(3, json.RootElement.GetProperty("selectedCount").GetInt32());
      var targets = json.RootElement.GetProperty("changes").EnumerateArray()
        .ToDictionary(item => item.GetProperty("packageId").GetString()!, item => item.GetProperty("to").GetString());
      Assert.Equal("13.6.1", targets["Aspire.AppHost.Sdk"]);
      Assert.Equal("13.6.2", targets["Aspire.Hosting"]);
      Assert.Equal("13.5.1", targets["Aspire.Hosting.Redis"]);
      Assert.DoesNotContain("AspireExtra", targets.Keys);
      Assert.DoesNotContain(feed.Requests, path => path.Contains("microsoft.net.sdk", StringComparison.OrdinalIgnoreCase));
      var bytes = await File.ReadAllBytesAsync(project, TestContext.Current.CancellationToken);
      Assert.True(bytes.AsSpan().StartsWith(new byte[] { 0xEF, 0xBB, 0xBF }));
      var expected = dryRun ? original : original
        .Replace("Name='Aspire.AppHost.Sdk' Version='13.6.0'", "Name='Aspire.AppHost.Sdk' Version='13.6.1'", StringComparison.Ordinal)
        .Replace("Include=\"Aspire.Hosting\" Version=\"13.6.0\"", "Include=\"Aspire.Hosting\" Version=\"13.6.2\"", StringComparison.Ordinal);
      Assert.Equal(expected, Encoding.UTF8.GetString(bytes[3..]));
      Assert.Equal(dryRun ? libraryOriginal : libraryOriginal.Replace("13.5.0", "13.5.1", StringComparison.Ordinal),
        await File.ReadAllTextAsync(library, TestContext.Current.CancellationToken));
    }
    finally { Directory.Delete(folder, true); }
  }

  [Fact]
  public async Task CliRejectsStaleSdkBeforeWritingRelatedLibrary()
  {
    var folder = CreateWorkspace();
    var project = Path.Combine(folder, "AppHost.csproj");
    var original = "<Project><Sdk Name='Aspire.AppHost.Sdk' Version='1.0.0'/>" +
      "<ItemGroup><PackageReference Include='Aspire.Hosting' Version='1.0.0'/></ItemGroup></Project>";
    var changed = original.Replace("Name='Aspire.AppHost.Sdk' Version='1.0.0'", "Name='Aspire.AppHost.Sdk' Version='1.0.1'", StringComparison.Ordinal);
    await File.WriteAllTextAsync(project, original, TestContext.Current.CancellationToken);
    await using var feed = new LocalFeed(onFlat: () => File.WriteAllText(project, changed));
    try
    {
      var result = await RunToolAsync("update", "--path", folder, "--family", "Aspire", "--source", feed.IndexUrl, "--yes", "--json");
      Assert.Equal(1, result.ExitCode);
      Assert.Contains("changed after discovery", result.Output);
      Assert.Equal(changed, await File.ReadAllTextAsync(project, TestContext.Current.CancellationToken));
    }
    finally { Directory.Delete(folder, true); }
  }

  [Fact]
  public async Task CliSkipsDirectoryAndFileSymlinksOutsideWorkspace()
  {
    if (OperatingSystem.IsWindows()) return;
    await using var feed = new LocalFeed();
    var folder = CreateWorkspace();
    var outside = CreateWorkspace();
    try
    {
      await File.WriteAllTextAsync(Path.Combine(folder, "Inside.csproj"),
        "<Project><PackageReference Include='Microsoft.Orleans.Core' Version='1.0.0'/></Project>", TestContext.Current.CancellationToken);
      var outsideFile = Path.Combine(outside, "Outside.csproj");
      await File.WriteAllTextAsync(outsideFile,
        "<Project><PackageReference Include='Microsoft.Orleans.Core' Version='1.0.0'/></Project>", TestContext.Current.CancellationToken);
      Directory.CreateSymbolicLink(Path.Combine(folder, "cycle"), folder);
      Directory.CreateSymbolicLink(Path.Combine(folder, "external"), outside);
      File.CreateSymbolicLink(Path.Combine(folder, "Linked.csproj"), outsideFile);
      var result = await RunToolAsync("check", "--path", folder, "--family", "Microsoft.Orleans", "--source", feed.IndexUrl, "--json");
      Assert.Equal(0, result.ExitCode);
      using var json = JsonDocument.Parse(result.Output);
      Assert.Equal(1, json.RootElement.GetProperty("selectedCount").GetInt32());
    }
    finally
    {
      Directory.Delete(folder, true);
      Directory.Delete(outside, true);
    }
  }

  [Fact]
  public async Task CliReportsOversizedProjectAndKeepsOtherResults()
  {
    await using var feed = new LocalFeed();
    var folder = CreateWorkspace();
    try
    {
      await File.WriteAllTextAsync(Path.Combine(folder, "Inside.csproj"),
        "<Project><PackageReference Include='Microsoft.Orleans.Core' Version='1.0.0'/></Project>", TestContext.Current.CancellationToken);
      await File.WriteAllTextAsync(Path.Combine(folder, "Huge.csproj"), new string('x', 1_000_100), TestContext.Current.CancellationToken);
      var result = await RunToolAsync("check", "--path", folder, "--family", "Microsoft.Orleans", "--source", feed.IndexUrl, "--json");
      Assert.Equal(0, result.ExitCode);
      using var json = JsonDocument.Parse(result.Output);
      Assert.Equal(1, json.RootElement.GetProperty("selectedCount").GetInt32());
      Assert.Contains("scan limit", json.RootElement.GetProperty("notices")[0].GetString());
    }
    finally { Directory.Delete(folder, true); }
  }

  private static string CreateWorkspace()
  {
    var path = Path.Combine(Path.GetTempPath(), "nuget-manager-tests-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(path);
    return path;
  }

  private static async Task<(int ExitCode, string Output)> RunToolAsync(params string[] arguments)
  {
    var dll = Path.Combine(AppContext.BaseDirectory, "ManagedCode.NuGet.Tool.dll");
    using var process = new Process
    {
      StartInfo = new ProcessStartInfo("dotnet")
      {
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false
      }
    };
    process.StartInfo.ArgumentList.Add(dll);
    foreach (var argument in arguments) process.StartInfo.ArgumentList.Add(argument);
    process.Start();
    using var cancel = TestContext.Current.CancellationToken.Register(() => { if (!process.HasExited) process.Kill(entireProcessTree: true); });
    var output = await process.StandardOutput.ReadToEndAsync(TestContext.Current.CancellationToken);
    var error = await process.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
    await process.WaitForExitAsync(TestContext.Current.CancellationToken);
    return (process.ExitCode, output + error);
  }

  private sealed class LocalFeed : IAsyncDisposable
  {
    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource _stop = new();
    private readonly Task _server;
    private readonly bool _failFlat;
    private readonly Action? _onFlat;
    private readonly string? _contentEncoding;
    private readonly bool _malformedCompression;
    private readonly bool _oversizedDecoded;
    private int _flatCount;
    private readonly IReadOnlyDictionary<string, string[]>? _packageVersions;
    public ConcurrentQueue<string> Requests { get; } = new();
    public string IndexUrl { get; }

    public LocalFeed(bool failFlat = false, Action? onFlat = null, string? contentEncoding = null,
        bool malformedCompression = false, bool oversizedDecoded = false, IReadOnlyDictionary<string, string[]>? packageVersions = null)
    {
      _failFlat = failFlat;
      _packageVersions = packageVersions;
      _onFlat = onFlat;
      _contentEncoding = contentEncoding;
      _malformedCompression = malformedCompression;
      _oversizedDecoded = oversizedDecoded;
      _listener.Start();
      var port = ((IPEndPoint)_listener.LocalEndpoint).Port;
      IndexUrl = $"http://127.0.0.1:{port}/v3/index.json";
      _server = ServeAsync($"http://127.0.0.1:{port}/");
    }

    private async Task ServeAsync(string root)
    {
      try
      {
        while (!_stop.IsCancellationRequested)
        {
          var connection = await _listener.AcceptTcpClientAsync(_stop.Token);
          _ = Task.Run(async () =>
          {
            using (connection)
            {
              try
              {
                var stream = connection.GetStream();
                using var reader = new StreamReader(stream, Encoding.ASCII, leaveOpen: true);
                var first = await reader.ReadLineAsync();
                while (!string.IsNullOrEmpty(await reader.ReadLineAsync())) { }
                var path = first?.Split(' ')[1] ?? "";
                Requests.Enqueue(path);
                var (status, json) = Respond(root, path);
                if (_oversizedDecoded && path.StartsWith("/reg/", StringComparison.Ordinal))
                  json += new string(' ', 5_000_001);
                var body = Encoding.UTF8.GetBytes(json);
                if (_contentEncoding is not null)
                  body = _malformedCompression && path.StartsWith("/reg/", StringComparison.Ordinal)
                    ? body : Compress(body, _contentEncoding);
                var encodingHeader = _contentEncoding is null ? "" : $"Content-Encoding: {_contentEncoding}\r\n";
                var header = Encoding.ASCII.GetBytes($"HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{encodingHeader}Content-Length: {body.Length}\r\nConnection: close\r\n\r\n");
                await stream.WriteAsync(header);
                await stream.WriteAsync(body);
              }
              catch (IOException) { }
            }
          });
        }
      }
      catch (OperationCanceledException) { }
    }

    private static byte[] Compress(byte[] body, string encoding)
    {
      using var output = new MemoryStream();
      using (Stream compressor = encoding switch
      {
        "gzip" => new GZipStream(output, CompressionLevel.SmallestSize, leaveOpen: true),
        "deflate" => new DeflateStream(output, CompressionLevel.SmallestSize, leaveOpen: true),
        "br" => new BrotliStream(output, CompressionLevel.SmallestSize, leaveOpen: true),
        _ => throw new ArgumentOutOfRangeException(nameof(encoding))
      }) compressor.Write(body);
      return output.ToArray();
    }

    private (string Status, string Body) Respond(string root, string path)
    {
      if (path == "/v3/index.json") return ("200 OK", JsonSerializer.Serialize(new
      {
        resources = new object[]
      {
                new Dictionary<string, string> { ["@id"] = root + "flat/", ["@type"] = "PackageBaseAddress/3.0.0" },
                new Dictionary<string, string> { ["@id"] = root + "reg/", ["@type"] = "RegistrationsBaseUrl/3.6.0" }
      }
      }));
      var segments = path.Split('/');
      var packageId = segments.Length > 2 ? segments[2] : "";
      var versions = _packageVersions?.GetValueOrDefault(packageId) ?? ["1.0.0", "1.1.0", "2.0.0"];
      if (path.StartsWith("/flat/", StringComparison.Ordinal))
      {
        if (Interlocked.Increment(ref _flatCount) == 1) _onFlat?.Invoke();
        return _failFlat ? ("503 Service Unavailable", "{}") : ("200 OK", JsonSerializer.Serialize(new { versions }));
      }
      if (path.StartsWith("/reg/", StringComparison.Ordinal)) return ("200 OK", JsonSerializer.Serialize(new
      {
        items = new[] { new { items = versions.Select((version, index) => new
        {
          catalogEntry = new { id = packageId, version, listed = index < versions.Length - 1 }
        }) } }
      }));
      return ("404 Not Found", "{}");
    }

    public async ValueTask DisposeAsync()
    {
      _stop.Cancel();
      _listener.Stop();
      try { await _server; } catch (SocketException) { }
      _stop.Dispose();
    }
  }
}
