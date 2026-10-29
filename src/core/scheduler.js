// In-process interval scheduler. Each job run takes a PostgreSQL advisory lock
// so only one server instance executes a job at a time, and every run is
// recorded in job_logs. Jobs decide for themselves whether their automation
// switch allows them to act.

import crypto from 'node:crypto';

/** @interface Job { name: string; intervalMs: number; run(): Promise<object|void> } */
export class Scheduler {
  constructor({ db, logger = console }) {
    this.db = db;
    this.logger = logger;
    this.jobs = new Map();
    this.timers = [];
  }
  register(job) {
    if (!job?.name || typeof job.run !== 'function') throw new Error('A job needs a name and run().');
    this.jobs.set(job.name, job);
    return this;
  }
  start() {
    for (const job of this.jobs.values()) {
      const timer = setInterval(() => { this.runOnce(job.name).catch((error) => this.logger.error(`Job ${job.name} failed`, error)); }, job.intervalMs);
      timer.unref?.();
      this.timers.push(timer);
    }
  }
  stop() { for (const timer of this.timers) clearInterval(timer); this.timers = []; }

  async runOnce(name) {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job ${name}.`);
    const lockId = crypto.createHash('sha256').update(`job:${name}`).digest().readInt32BE(0);
    return this.db.withConnection(async () => {
      const { locked } = await this.db.prepare('SELECT pg_try_advisory_lock(?) AS locked').get(lockId);
      if (!locked) return { status: 'SKIPPED', message: 'Another instance is running this job.' };
      const log = await this.db.prepare("INSERT INTO job_logs(job_name,status) VALUES(?,'RUNNING') RETURNING id").get(name);
      try {
        const detail = (await job.run()) ?? {};
        const status = detail.skipped ? 'SKIPPED' : 'SUCCEEDED';
        await this.db.prepare('UPDATE job_logs SET status=?,finished_at=now(),message=?,detail=?::text::jsonb WHERE id=?').run(status, detail.message ?? null, JSON.stringify(detail), log.id);
        return { status, ...detail };
      } catch (error) {
        await this.db.prepare("UPDATE job_logs SET status='FAILED',finished_at=now(),message=? WHERE id=?").run(String(error?.message || error).slice(0, 500), log.id);
        throw error;
      } finally {
        await this.db.prepare('SELECT pg_advisory_unlock(?)').get(lockId);
      }
    });
  }
}
