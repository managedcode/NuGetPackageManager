using System.Text.Json;
using ManagedCode.NuGet.Tool;

if (args.Length == 1 && args[0] == "--bridge") return await Bridge.RunAsync();
return await CommandLine.RunAsync(args);
