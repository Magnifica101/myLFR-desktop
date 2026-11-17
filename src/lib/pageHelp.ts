/** The FAQ questions each page's Help button lists, most useful first. */
export const PAGE_HELP = {
  home: ['when-backups-happen', 'backup-warnings', 'switch-year', 'blue-button'],
  'permit-holders': ['add-permit-holder', 'shared-vessel', 'archive-permit-holder'],
  landings: ['record-landing', 'enter-weight', 'fix-landing', 'delete-landing', 'find-landing'],
  species: ['find-fishstock', 'favourites', 'missing-fishstock'],
  summaries: ['when-due', 'monthly-figures', 'save-summary', 'pdf-or-excel', 'check-figures'],
  export: ['export-data', 'export-excel'],
  resources: ['resources'],
  settings: ['edit-business-details', 'add-logo', 'choose-backup-folder', 'restore', 'update', 'report-problem'],
} as const satisfies Record<string, readonly string[]>;

export type HelpPage = keyof typeof PAGE_HELP;
