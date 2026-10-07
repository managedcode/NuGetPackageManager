import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const media = path.join(root, 'media/Features/PackageUpdates');
const output = path.join(root, '.preview');
await mkdir(output, { recursive: true });
await Promise.all([
  copyFile(path.join(media, 'app.js'), path.join(output, 'app.js')),
  copyFile(path.join(media, 'style.css'), path.join(output, 'style.css')),
]);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NuGet Package Manager UI preview</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/style.css">
<style>
:root{--vscode-editor-background:#15181b;--vscode-sideBar-background:#1b1e22;--vscode-editorWidget-background:#24282d;--vscode-foreground:#eceee9;--vscode-descriptionForeground:#969e9e;--vscode-panel-border:#30363a;--vscode-focusBorder:#ff7e5d;--vscode-button-background:#ff7e5d;--vscode-button-foreground:#21130f;--vscode-font-family:system-ui,sans-serif;--vscode-editor-font-family:ui-monospace,monospace}
.vscode-light{color-scheme:light;--vscode-editor-background:#f7f8f5;--vscode-sideBar-background:#fff;--vscode-editorWidget-background:#edf0e9;--vscode-foreground:#222821;--vscode-descriptionForeground:#677066;--vscode-panel-border:#d8ded4;--vscode-focusBorder:#b33a20;--vscode-button-background:#b33a20;--vscode-button-foreground:#fff}
.vscode-dark{color-scheme:dark}
.preview-banner{font:12px system-ui;padding:10px 20px;background:#ffe7b3;color:#3a2a00;text-align:center}
</style></head>
<body class="vscode-dark"><div class="preview-banner">Illustrative browser preview · selection and review use a simulated bridge · no workspace files are read or written</div><div id="app"></div>
<script>window.__previewMessages=[];
const fileA='file:///sample/Directory.Packages.props', fileB='file:///sample/App.csproj';
const rows=[
 {key:'central-http',packageId:'Microsoft.Extensions.Http',version:'8.0.0',start:0,end:5,kind:'PackageVersion',file:fileA,fileLabel:'Directory.Packages.props',group:'Microsoft',families:['Microsoft','Microsoft.Extensions','Microsoft.Extensions.Http'],versions:['8.0.0','8.0.1','9.0.0'],target:'8.0.1',updateKind:'patch',status:'update'},
 {key:'project-logging',packageId:'Microsoft.Extensions.Logging',version:'8.0.0',start:0,end:5,kind:'PackageReference',file:fileB,fileLabel:'App.csproj',group:'Microsoft',families:['Microsoft','Microsoft.Extensions','Microsoft.Extensions.Logging'],versions:['8.0.0','8.0.1'],target:'8.0.1',updateKind:'patch',status:'update'},
 {key:'central-orleans',packageId:'Microsoft.Orleans',version:'8.0.0',start:0,end:5,kind:'PackageVersion',file:fileA,fileLabel:'Directory.Packages.props',group:'Microsoft',families:['Microsoft','Microsoft.Orleans'],versions:['8.0.0','8.1.0'],target:'8.1.0',updateKind:'minor',status:'update'},
 {key:'project-orleans-host',packageId:'Microsoft.Orleans.Hosting',version:'8.0.0',start:0,end:5,kind:'PackageReference',file:fileB,fileLabel:'App.csproj',group:'Microsoft',families:['Microsoft','Microsoft.Orleans','Microsoft.Orleans.Hosting'],versions:['8.0.0','8.1.0'],target:'8.1.0',updateKind:'minor',status:'update'},
 {key:'project-orleans-sql',packageId:'Microsoft.Orleans.Persistence.Sql',version:'8.0.0',start:0,end:5,kind:'PackageReference',file:fileB,fileLabel:'App.csproj',group:'Microsoft',families:['Microsoft','Microsoft.Orleans','Microsoft.Orleans.Persistence','Microsoft.Orleans.Persistence.Sql'],versions:['8.0.0','8.1.0'],target:'8.1.0',updateKind:'minor',status:'update'},
 {key:'central-orleans-extra',packageId:'Microsoft.OrleansExtra',version:'8.0.0',start:0,end:5,kind:'PackageVersion',file:fileA,fileLabel:'Directory.Packages.props',group:'Microsoft',families:['Microsoft','Microsoft.OrleansExtra'],versions:['8.0.0','8.1.0'],target:'8.1.0',updateKind:'minor',status:'update'},
 {key:'central-json',packageId:'System.Text.Json',version:'8.0.4',start:0,end:5,kind:'PackageVersion',file:fileA,fileLabel:'Directory.Packages.props',group:'System',families:['System','System.Text','System.Text.Json'],versions:['8.0.4','8.0.5'],target:'8.0.5',updateKind:'patch',status:'update'},
 {key:'central-serilog',packageId:'Serilog',version:'4.0.0',start:0,end:5,kind:'PackageVersion',file:fileA,fileLabel:'Directory.Packages.props',group:'Serilog',families:['Serilog'],versions:['4.0.0','4.1.0','5.0.0'],target:'4.1.0',updateKind:'minor',status:'update'},
 {key:'central-telemetry',packageId:'OpenTelemetry',version:'1.9.0',start:0,end:5,kind:'PackageVersion',file:fileA,fileLabel:'Directory.Packages.props',group:'OpenTelemetry',families:['OpenTelemetry'],versions:['1.9.0','1.10.0','2.0.0'],target:'1.10.0',updateKind:'minor',status:'update'},
 {key:'project-test',packageId:'xunit',version:'2.8.1',start:0,end:5,kind:'PackageReference',file:fileB,fileLabel:'App.csproj',group:'xunit',families:['xunit'],versions:['2.8.1','2.9.0'],target:'2.9.0',updateKind:'minor',status:'update'},
 {key:'project-polly',packageId:'Polly',version:'8.4.0',start:0,end:5,kind:'PackageReference',file:fileB,fileLabel:'App.csproj',group:'Polly',families:['Polly'],versions:['8.4.0','8.4.1'],target:'8.4.1',updateKind:'patch',status:'update'},
 {key:'project-current',packageId:'Microsoft.Extensions.Configuration',version:'8.0.0',start:0,end:5,kind:'PackageReference',file:fileB,fileLabel:'App.csproj',group:'Microsoft',families:['Microsoft','Microsoft.Extensions','Microsoft.Extensions.Configuration'],versions:['8.0.0'],status:'current'},
 {key:'project-failed',packageId:'Private.Build.Tools',version:'3.2.0',start:0,end:5,kind:'PackageReference',file:fileB,fileLabel:'App.csproj',group:'Private',families:['Private','Private.Build','Private.Build.Tools'],versions:[],status:'error',error:'The source requires authentication.'}
];
const initial={rows,files:[{uri:fileA,label:'Directory.Packages.props',count:7},{uri:fileB,label:'App.csproj',count:6}],notices:[],feeds:[{name:'Illustrative local feed',url:'https://example.invalid/v3/index.json'}],busy:false,progress:100,checkedAt:new Date().toISOString(),trusted:true,policy:'latest',prerelease:false};
const theme=new URLSearchParams(location.search).get('theme');if(theme==='light'||theme==='dark')document.body.className='vscode-'+theme;
let current=initial;
window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:message=>{
 window.__previewMessages.push(message);
 if(message.type==='ready') window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:current}}));
 if(message.type==='policy'){
   const policy=message.policy, prerelease=message.prerelease;
   const rank=version=>version.split(/[.-]/).slice(0,3).map(Number);
   current={...current,policy,prerelease,rows:current.rows.map(row=>{
     if(!row.versions.length)return row;
     const base=rank(row.version), available=row.versions.filter(version=>prerelease||!version.includes('-')).filter(version=>{const next=rank(version);return (next[0]>base[0]||next[0]===base[0]&&(next[1]>base[1]||next[1]===base[1]&&next[2]>base[2]))&&(policy==='latest'||next[0]===base[0])&&(policy!=='patch'||next[1]===base[1]);});
     const target=available.at(-1);return {...row,target,updateKind:target?(rank(target)[0]>base[0]?'major':rank(target)[1]>base[1]?'minor':'patch'):undefined,status:target?'update':'current'};
   })};window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:current}}));
 }
 if(message.type==='target'){
   current={...current,rows:current.rows.map(row=>row.key===message.key&&row.versions.includes(message.version)?{...row,target:message.version,status:'update'}:row)};
   window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:current}}));
 }
 if(message.type==='review'){
   const keys=new Set(message.keys||[]), plan=current.rows.filter(row=>keys.has(row.key)).map(row=>({key:row.key,packageId:row.packageId,from:row.version,to:row.target,file:row.file,fileLabel:row.fileLabel}));
   current={...current,plan}; window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:current}}));
 }
 if(message.type==='back'){current={...current,plan:undefined};window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:current}}));}
 if(message.type==='apply'){
   const note='Preview only: the simulated host does not write workspace files.';
   window.dispatchEvent(new MessageEvent('message',{data:{type:'error',message:note}}));
 }
}});
</script><script src="/app.js"></script></body></html>`;
await writeFile(path.join(output, 'index.html'), html);

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const server = http.createServer(async (request, response) => {
  const entry = files.get(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (!entry) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.setHeader('content-type', entry[1]);
  response.end(await readFile(path.join(output, entry[0])));
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => {
  const address = server.address();
  console.log(`UI preview: http://127.0.0.1:${address.port}`);
  console.log('Selection/review are simulated; apply never writes workspace files. Press Ctrl+C to stop.');
});
