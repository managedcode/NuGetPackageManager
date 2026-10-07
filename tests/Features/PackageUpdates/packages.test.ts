import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EngineClient } from '../../../src/Features/PackageUpdates/Host/engine';

const engine = new EngineClient();

async function changeFor(text: string, index = 0) {
  const declaration = (await engine.parse(text)).declarations[index];
  return { ...declaration, from: declaration.version, to: '2.1.3' };
}

test('parses literal versions and applies only their UTF-16 spans, preserving CRLF, BOM, comments and ordering', async () => {
  const text =
    '\uFEFF<Project>\r\n  <!-- PackageVersion Include="Fake" Version="1.0" -->\r\n  <ItemGroup>\r\n    <PackageVersion Version = \'1.2.3\' Include="A.B" Condition="\'$(TFM)\' == \'net10.0\'" />\r\n  </ItemGroup>\r\n</Project>\r\n';
  assert.equal((await engine.parse(text)).declarations.length, 1);
  assert.equal(
    await engine.apply(text, [await changeFor(text)]),
    text.replace("Version = '1.2.3'", "Version = '2.1.3'"),
  );
});

test('returns UTF-16 offsets after Unicode and applies child Version declarations', async () => {
  const text =
    '<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003"><!-- 🧊 > -->\n<PackageReference Update="A.B"><Version> 1.0.0 </Version></PackageReference></Project>';
  const declaration = (await engine.parse(text)).declarations[0];
  assert.equal(text.slice(declaration.start, declaration.end), '1.0.0');
  assert.equal(declaration.kind, 'PackageReference');
  assert.equal(await engine.apply(text, [await changeFor(text)]), text.replace(' 1.0.0 ', ' 2.1.3 '));
});

test('ignores XML comments and CDATA containing fake declarations', async () => {
  const text =
    '<Project><!-- <PackageVersion Include="Fake" Version="1.0"/> --><Value><![CDATA[<PackageVersion Include="Fake2" Version="1.0"/>]]></Value><PackageVersion Include="Real" Version="1.0"/></Project>';
  assert.deepEqual(
    (await engine.parse(text)).declarations.map((d) => d.packageId),
    ['Real'],
  );
});

test('keeps conditionally duplicated declarations independently editable', async () => {
  const text =
    '<Project><PackageVersion Include="A" Version="1.0" Condition="a"/><PackageVersion Include="A" Version="1.0" Condition="b"/></Project>';
  const declarations = (await engine.parse(text)).declarations;
  assert.notEqual(declarations[0].key, declarations[1].key);
  assert.equal(
    await engine.apply(text, [await changeFor(text, 1)]),
    text.replace('Version="1.0" Condition="b"', 'Version="2.1.3" Condition="b"'),
  );
});

test('reports properties, ranges and wildcards as ignored instead of editable targets', async () => {
  const text =
    '<Project><PackageVersion Include="Property" Version="$(SharedVersion)"/><PackageVersion Include="Range" Version="[1,2)"/><PackageVersion Include="Floating" Version="1.*"/><PackageReference Include="Central"/><PackageVersion Include="Child"><Version>$(Other)</Version></PackageVersion></Project>';
  const result = await engine.parse(text);
  assert.equal(result.declarations.length, 0);
  assert.equal(result.ignored.length, 4);
});

test('rejects malformed XML, duplicate attributes and external entity declarations', async () => {
  for (const text of [
    '<Project><PackageVersion></Project>',
    '<Project><PackageVersion Include="A" Version="1" Version="2"/></Project>',
    '<!DOCTYPE Project SYSTEM "file:///etc/passwd"><Project/>',
  ]) {
    await assert.rejects(engine.parse(text));
  }
});

test('applies multiple edits of different lengths while retaining all other bytes', async () => {
  const text =
    '<Project><PackageVersion Include="A" Version="1"/><PackageVersion Include="B" Version="10.0.0"/></Project>';
  assert.equal(
    await engine.apply(text, [await changeFor(text), await changeFor(text, 1)]),
    text.replace('Version="1"', 'Version="2.1.3"').replace('Version="10.0.0"', 'Version="2.1.3"'),
  );
});

test('rejects stale, duplicate, out-of-bounds and invalid target changes', async () => {
  const text = '<Project><PackageVersion Include="A" Version="1.0"/></Project>';
  const planned = await changeFor(text);
  await assert.rejects(engine.apply(text.replace('1.0', '1.1'), [planned]), /changed/i);
  await assert.rejects(engine.apply(text, [planned, planned]), /changed|duplicate|overlap/i);
  await assert.rejects(engine.apply(text, [{ ...planned, start: -1 }]), /changed|range|offset/i);
  await assert.rejects(engine.apply(text, [{ ...planned, to: '"/><Bad/>' }]));
});

test('exposes complete dotted family prefixes without crossing sibling boundaries', async () => {
  const text =
    '<Project><PackageVersion Include="Microsoft.Orleans" Version="1.0.0"/><PackageVersion Include="Microsoft.Orleans.Hosting" Version="1.0.0"/><PackageVersion Include="Microsoft.OrleansExtra" Version="1.0.0"/><PackageVersion Include="Microsoft.Extensions.Logging" Version="1.0.0"/></Project>';
  const declarations = (await engine.parse(text)).declarations;
  const byId = new Map(declarations.map((declaration) => [declaration.packageId, declaration]));
  assert.deepEqual(byId.get('Microsoft.Orleans')?.families, ['Microsoft', 'Microsoft.Orleans']);
  assert.deepEqual(byId.get('Microsoft.Orleans.Hosting')?.families, [
    'Microsoft',
    'Microsoft.Orleans',
    'Microsoft.Orleans.Hosting',
  ]);
  assert.deepEqual(byId.get('Microsoft.OrleansExtra')?.families, ['Microsoft', 'Microsoft.OrleansExtra']);
  assert.equal(byId.get('Microsoft.Extensions.Logging')?.families.includes('Microsoft.Orleans'), false);
});
