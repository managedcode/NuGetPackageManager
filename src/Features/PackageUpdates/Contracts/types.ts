export type UpdateKind = 'major' | 'minor' | 'patch' | 'revision' | 'prerelease';
export type Policy = 'latest' | 'minor' | 'patch';

export interface Declaration {
  key: string;
  packageId: string;
  version: string;
  start: number;
  end: number;
  kind: 'PackageVersion' | 'PackageReference';
  condition?: string;
  group: string;
  families: string[];
}

export interface PackageRow extends Declaration {
  file: string;
  fileLabel: string;
  group: string;
  versions: string[];
  target?: string;
  updateKind?: UpdateKind;
  status: 'unchecked' | 'checking' | 'current' | 'update' | 'error';
  error?: string;
}

export interface IgnoredDeclaration {
  packageId: string;
  reason: string;
}

export interface Feed {
  name: string;
  url: string;
}

export interface PlannedChange {
  key: string;
  packageId: string;
  from: string;
  to: string;
  file: string;
  fileLabel: string;
  start: number;
  end: number;
  condition?: string;
}

export interface ViewState {
  rows: PackageRow[];
  files: { uri: string; label: string; count: number }[];
  notices: string[];
  feeds: Feed[];
  busy: boolean;
  progress: number;
  checkedAt?: string;
  trusted: boolean;
  policy: Policy;
  prerelease: boolean;
  plan?: PlannedChange[];
}
