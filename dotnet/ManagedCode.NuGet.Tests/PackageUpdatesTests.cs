using ManagedCode.NuGet.Core.Features.PackageUpdates;
using Xunit;

namespace ManagedCode.NuGet.Tests;

public sealed class PackageUpdatesTests
{
  [Fact]
  public void ConditionalVersionsKeepIndependentUtf16Ranges()
  {
    var xml = "<Project><!-- 😀 --><ItemGroup><PackageReference Include=\"Microsoft.Orleans.Core\">" +
              "<Version Condition=\"Debug\">1.0.0</Version><Version Condition=\"Release\">2.0.0</Version>" +
              "</PackageReference></ItemGroup></Project>";
    var parsed = PackageDocuments.Parse(xml);
    Assert.Equal(2, parsed.Declarations.Count);
    Assert.Equal("1.0.0", xml[parsed.Declarations[0].Start..parsed.Declarations[0].End]);
    Assert.Equal("2.0.0", xml[parsed.Declarations[1].Start..parsed.Declarations[1].End]);
    Assert.Contains("Debug", parsed.Declarations[0].Condition);
    Assert.Contains("Release", parsed.Declarations[1].Condition);
    Assert.Equal(["Microsoft", "Microsoft.Orleans", "Microsoft.Orleans.Core"], parsed.Declarations[0].Families);
  }

  [Fact]
  public void CommentsAndCdataAreIgnoredButActualDtdIsRejected()
  {
    var xml = "<Project><!-- <!DOCTYPE test> --><![CDATA[<PackageVersion Include='Hidden' Version='9.0'/>]]>" +
              "<ItemGroup><PackageVersion Include='Visible' Version='1.0'/></ItemGroup></Project>";
    Assert.Single(PackageDocuments.Parse(xml).Declarations);
    Assert.Throws<InvalidOperationException>(() => PackageDocuments.Parse("<!DOCTYPE Project><Project/>"));
  }

  [Fact]
  public void FamilyMatchesOnlyExactOrDottedDescendants()
  {
    Assert.True(PackageVersions.MatchesFamily("Microsoft.Orleans", "microsoft.orleans"));
    Assert.True(PackageVersions.MatchesFamily("Microsoft.Orleans.Core", "microsoft.orleans"));
    Assert.False(PackageVersions.MatchesFamily("Microsoft.OrleansExtra", "microsoft.orleans"));
    Assert.False(PackageVersions.MatchesFamily("Microsoft.Orleans.Core", "microsoft.orleans.extra"));
  }

  [Fact]
  public void ResolveUsesNuGetVersionOrderAndPolicy()
  {
    var versions = new[] { "1.0.1", "1.2.0", "2.0.0", "1.0.2-preview.1", "1.0.0.1" };
    Assert.Equal("1.0.1", PackageVersions.Resolve("1.0.0", versions, "patch").Target);
    Assert.Equal("1.2.0", PackageVersions.Resolve("1.0.0", versions, "minor").Target);
    Assert.Equal("2.0.0", PackageVersions.Resolve("1.0.0", versions, "latest").Target);
    Assert.Equal("1.0.2-preview.1", PackageVersions.Resolve("1.0.0", versions, "patch", true).Target);
    Assert.Equal("1.0.0.1", PackageVersions.Resolve("1.0.0", ["1.0.0.1"], "patch").Target);
  }

  [Fact]
  public void ApplyOnlyChangesReviewedVersionAndRejectsStaleSnapshot()
  {
    var text = "\uFEFF<Project>\r\n<!-- keep -->\r\n<PackageVersion Include='X' Version='1.0.0'/>\r\n</Project>";
    var declaration = Assert.Single(PackageDocuments.Parse(text).Declarations);
    var change = new PlannedChange(declaration.Key, "X", "1.0.0", "1.1.0", "file", "file", declaration.Start, declaration.End, null);
    var updated = PackageDocuments.Apply(text, [change]);
    Assert.Equal(text.Replace("1.0.0", "1.1.0", StringComparison.Ordinal), updated);
    Assert.Throws<InvalidOperationException>(() => PackageDocuments.Apply(text.Replace("1.0.0", "1.0.1", StringComparison.Ordinal), [change]));
  }
}
