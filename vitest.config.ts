import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // This machine has produced false greens when two workers share one temp
    // file: the loser gets EPERM and the file never loads. One worker, and the
    // suite asserts its own test count (see scripts/verify.sh).
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
