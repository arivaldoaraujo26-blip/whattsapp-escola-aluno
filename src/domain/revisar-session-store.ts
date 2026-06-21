export interface RevisarSession {
  original: string;
  rewritten: string;
}

export class RevisarSessionStore {
  private readonly sessions = new Map<string, RevisarSession>();

  set(teacherId: string, session: RevisarSession): void {
    this.sessions.set(teacherId, session);
  }

  get(teacherId: string): RevisarSession | undefined {
    return this.sessions.get(teacherId);
  }

  delete(teacherId: string): void {
    this.sessions.delete(teacherId);
  }
}
