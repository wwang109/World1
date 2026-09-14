/** One completed click/tap arms this card; only a second on the same instance opens it. */
export class CardDetailActivation {
  private pending: { key: string; time: number } | null = null;

  constructor(private readonly intervalMs = 400) {}

  release(key: string, time: number): boolean {
    const previous = this.pending;
    this.pending = { key, time };
    if (previous?.key === key && time >= previous.time && time - previous.time <= this.intervalMs) {
      this.reset();
      return true;
    }
    return false;
  }

  reset(): void { this.pending = null; }
}
