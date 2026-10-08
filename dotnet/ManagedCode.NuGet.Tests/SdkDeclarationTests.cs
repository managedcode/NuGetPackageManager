using ManagedCode.NuGet.Core.Features.PackageUpdates;
using Xunit;

namespace ManagedCode.NuGet.Tests;

public sealed class SdkDeclarationTests
{
  [Fact]
  public void SdkAndPackagesKeepIndependentLiteralRangesAndConditions()
  {
    var text = "\uFEFF<Project>\r\n<!-- 😀 keep -->\r\n" +
      "<Sdk Name='Aspire.AppHost.Sdk' Version='13.6.0' Condition='Debug'/>\r\n" +
      "<Sdk Name=\"Aspire.AppHost.Sdk\" Version=\"13.5.0\" Condition=\"Release\"></Sdk>\r\n" +
      "<ItemGroup><PackageReference Include='Aspire.Hosting' Version='13.6.0'/>" +
      "<PackageVersion Include='Aspire.Hosting.Redis'><Version>13.6.0</Version></PackageVersion></ItemGroup></Project>";
    var parsed = PackageDocuments.Parse(text);
    Assert.Empty(parsed.Ignored);
    Assert.Equal(4, parsed.Declarations.Count);
    var sdks = parsed.Declarations.Where(item => item.Kind == "Sdk").ToArray();
    Assert.Equal(2, sdks.Length);
    Assert.NotEqual(sdks[0].Key, sdks[1].Key);
    Assert.Equal("Debug", sdks[0].Condition);
    Assert.Equal("Release", sdks[1].Condition);
    Assert.Equal(["Aspire", "Aspire.AppHost", "Aspire.AppHost.Sdk"], sdks[0].Families);
    foreach (var declaration in parsed.Declarations)
      Assert.Equal(declaration.Version, text[declaration.Start..declaration.End]);
    var changes = sdks.Select(item => new PlannedChange(item.Key, item.PackageId, item.Version,
      "13.6.1", "file", "file", item.Start, item.End, item.Condition));
    var updated = PackageDocuments.Apply(text, changes);
    Assert.Equal(text.Replace("Version='13.6.0' Condition", "Version='13.6.1' Condition", StringComparison.Ordinal)
      .Replace("Version=\"13.5.0\"", "Version=\"13.6.1\"", StringComparison.Ordinal), updated);
    Assert.Throws<InvalidOperationException>(() => PackageDocuments.Apply(
      text.Replace("Version='13.6.0' Condition", "Version='13.6.2' Condition", StringComparison.Ordinal), changes));
  }

  [Fact]
  public void AbsentAndVersionlessSdkDeclarationsNeverBecomeTargets()
  {
    var text = "<Project Sdk='Aspire.AppHost.Sdk/13.6.0'><Sdk Name='Microsoft.NET.Sdk'/>" +
      "<Sdk Name='Aspire.AppHost.Sdk'><Version>13.6.0</Version></Sdk>" +
      "<Import Sdk='Aspire.AppHost.Sdk' Version='13.6.0'/></Project>";
    var parsed = PackageDocuments.Parse(text);
    Assert.Empty(parsed.Declarations);
    Assert.Empty(parsed.Ignored);
    Assert.Empty(PackageDocuments.Parse("<Project/>").Declarations);
    Assert.Equal("<Project/>", PackageDocuments.Apply("<Project/>", []));
  }

  [Fact]
  public void FakeNestedAndUnrelatedSdkElementsAreNotDependencies()
  {
    var text = "<Project><!-- <Sdk Name='Hidden' Version='1.0.0'/> -->" +
      "<![CDATA[<Sdk Name='Hidden' Version='1.0.0'/>]]>" +
      "<ItemGroup><Sdk Name='Nested' Version='1.0.0'/></ItemGroup>" +
      "<Project><Sdk Name='NestedProject' Version='1.0.0'/></Project></Project>";
    Assert.Empty(PackageDocuments.Parse(text).Declarations);
    Assert.Empty(PackageDocuments.Parse("<Other><Sdk Name='Unrelated' Version='1.0.0'/></Other>").Declarations);
  }

  [Theory]
  [InlineData("Aspire.AppHost.Sdk", "$(AspireVersion)")]
  [InlineData("Aspire.AppHost.Sdk", "[13.6.0,14.0.0)")]
  [InlineData("Aspire.AppHost.Sdk", "13.*")]
  [InlineData("Aspire.AppHost.Sdk", "")]
  [InlineData("$(SdkName)", "13.6.0")]
  [InlineData("invalid/id", "13.6.0")]
  [InlineData("", "13.6.0")]
  public void ExplicitUnsupportedSdkVersionsAndIdsRequireManualEditing(string name, string version)
  {
    var parsed = PackageDocuments.Parse($"<Project><Sdk Name='{name}' Version='{version}'/></Project>");
    Assert.Empty(parsed.Declarations);
    Assert.Equal(name, Assert.Single(parsed.Ignored).PackageId);
  }

  [Fact]
  public void SdkChildVersionNeverOverridesAttributeVersion()
  {
    var parsed = PackageDocuments.Parse("<Project><Sdk Name='Aspire.AppHost.Sdk' Version='13.6.0'>" +
      "<Version>99.0.0</Version></Sdk></Project>");
    Assert.Equal("13.6.0", Assert.Single(parsed.Declarations).Version);
  }
}
