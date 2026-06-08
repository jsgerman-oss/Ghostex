export interface T3FilesystemBrowseInput {
  cwd?: string;
  partialPath: string;
}

export interface T3FilesystemBrowseEntry {
  fullPath: string;
  name: string;
}

export interface T3FilesystemBrowseResult {
  entries: T3FilesystemBrowseEntry[];
  parentPath: string;
}
