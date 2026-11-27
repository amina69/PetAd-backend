export enum Role {
  USER = 'USER',
  SHELTER = 'SHELTER',
  ADMIN = 'ADMIN',
}

export namespace Role {
  export const AUDITOR = 'AUDITOR' as const;
}
