using System;
using System.IO;
using System.Text.Json;
using FourBros.Display;

if (args.Length != 1) throw new ArgumentException("Pass the repository unity-display-contract.json path");
var fixture = JsonSerializer.Deserialize<ContractFixture>(File.ReadAllText(args[0]),
    new JsonSerializerOptions { IncludeFields = true });
int count = DisplayContractChecks.Run(fixture);
Console.WriteLine($"PASS: {count} assertions against production C# display core and repository fixture.");
Console.WriteLine("UnityEngine compilation, JsonUtility parsing, scene rendering and builds are NOT covered by this .NET run.");
