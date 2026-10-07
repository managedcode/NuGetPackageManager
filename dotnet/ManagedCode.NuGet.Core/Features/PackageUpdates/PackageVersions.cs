using NuGet.Versioning;

namespace ManagedCode.NuGet.Core.Features.PackageUpdates;

public static class PackageVersions
{
  public static bool TryParse(string? value, out NuGetVersion version)
  {
    if (!string.IsNullOrWhiteSpace(value) && NuGetVersion.TryParse(value, out var parsed) && parsed is not null)
    {
      version = parsed;
      return true;
    }
    version = null!;
    return false;
  }

  public static int Compare(string left, string right) =>
      VersionComparer.VersionRelease.Compare(Parse(left), Parse(right));

  public static NuGetVersion Parse(string value) =>
      TryParse(value, out var parsed) ? parsed : throw new ArgumentException("Expected a literal NuGet version.", nameof(value));

  public static ResolveResult Resolve(string current, IEnumerable<string> versions, string? policy = null, bool prerelease = false)
  {
    var from = Parse(current);
    policy ??= "latest";
    if (policy is not ("latest" or "minor" or "patch")) throw new ArgumentException("Invalid update policy.");
    var eligible = versions.Where(v => TryParse(v, out var candidate)
        && (prerelease || !candidate.IsPrerelease)
        && VersionComparer.VersionRelease.Compare(candidate, from) > 0
        && (policy == "latest" || candidate.Major == from.Major)
        && (policy != "patch" || candidate.Minor == from.Minor))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .OrderBy(v => Parse(v), VersionComparer.VersionRelease)
        .ToArray();
    var target = eligible.LastOrDefault();
    return new ResolveResult(target, target is null ? null : Classify(from, Parse(target)), eligible);
  }

  public static string Classify(NuGetVersion from, NuGetVersion to)
  {
    if (from.Major != to.Major) return "major";
    if (from.Minor != to.Minor) return "minor";
    if (from.Patch != to.Patch) return "patch";
    if (from.Revision != to.Revision) return "revision";
    return "prerelease";
  }

  public static string FirstSegment(string packageId) => packageId.Split('.')[0];

  public static IReadOnlyList<string> Families(string packageId)
  {
    var parts = packageId.Split('.');
    return Enumerable.Range(1, parts.Length).Select(count => string.Join('.', parts.Take(count))).ToArray();
  }

  public static bool MatchesFamily(string packageId, string family) =>
      !string.IsNullOrWhiteSpace(family) &&
      (packageId.Equals(family, StringComparison.OrdinalIgnoreCase) ||
       packageId.StartsWith(family + ".", StringComparison.OrdinalIgnoreCase));
}
