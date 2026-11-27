export enum Role {
  USER = 'USER',
  SHELTER = 'SHELTER',
  ADMIN = 'ADMIN',
  ANALYST = 'ANALYST',
}

export namespace Role {
  export const AUDITOR = 'AUDITOR' as const;
}
