import { SerialQueue } from './indexing.controller';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('SerialQueue', () => {
  it('runs jobs one at a time, in order', async () => {
    const queue = new SerialQueue();
    const events: string[] = [];
    const job = (name: string) => async () => {
      events.push(`start ${name}`);
      await tick();
      events.push(`end ${name}`);
      return name;
    };

    const results = await Promise.all([
      queue.run(job('a')),
      queue.run(job('b')),
      queue.run(job('c')),
    ]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(events).toEqual([
      'start a',
      'end a',
      'start b',
      'end b',
      'start c',
      'end c',
    ]);
  });

  it('keeps going after a job fails', async () => {
    const queue = new SerialQueue();
    const failed = queue.run(() => Promise.reject(new Error('boom')));
    const next = queue.run(() => Promise.resolve('ok'));
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
