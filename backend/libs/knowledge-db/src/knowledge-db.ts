import {
  Global,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';

/**
 * knowledge.* is raw SQL (see infra/postgres/init.sql), not Prisma, so the
 * indexing and retrieval services talk to it through a plain pg Pool. That
 * also allows unnest()-based bulk inserts and DISTINCT ON, which Prisma
 * can't express.
 */
export const KNOWLEDGE_POOL = Symbol('KNOWLEDGE_POOL');

@Injectable()
class KnowledgePoolLifecycle implements OnModuleDestroy {
  constructor(@Inject(KNOWLEDGE_POOL) private readonly pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: KNOWLEDGE_POOL,
      useFactory: () =>
        new Pool({
          connectionString: process.env.DATABASE_URL,
          max: Number(process.env.KNOWLEDGE_DB_POOL_SIZE ?? 5),
        }),
    },
    KnowledgePoolLifecycle,
  ],
  exports: [KNOWLEDGE_POOL],
})
export class KnowledgeDbModule {}
