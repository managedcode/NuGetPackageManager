namespace ManagedCode.NuGet.Core.Features.PackageUpdates;

public sealed record Declaration(string Key, string PackageId, string Version, int Start, int End, string Kind, string? Condition, string Group, IReadOnlyList<string> Families);
public sealed record IgnoredDeclaration(string PackageId, string Reason);
public sealed record ParseResult(IReadOnlyList<Declaration> Declarations, IReadOnlyList<IgnoredDeclaration> Ignored);
public sealed record PlannedChange(string Key, string PackageId, string From, string To, string File, string FileLabel, int Start, int End, string? Condition);
public sealed record ResolveResult(string? Target, string? UpdateKind, IReadOnlyList<string> Versions);
public sealed record Feed(string Name, string Url);
