// For calls that overlap and can finish out of order: begin() hands each call a check that stays
// true only while no later call has begun, so a slow, older call can step aside.
export class LatestCall {
  private latest = 0;

  begin() {
    this.latest += 1;
    const token = this.latest;
    return () => token === this.latest;
  }
}
