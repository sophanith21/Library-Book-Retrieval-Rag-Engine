import { Controller } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { EmbedBookDto, PATTERNS, ProcessBookIndexDto } from '@app/contracts';
import { IndexingService } from './indexing.service';

/**
 * RabbitMQ handlers. Messages are acked manually, only once processed, so a
 * crash mid-book leaves the message on the queue. Several messages are
 * delivered at once (see main.ts) so reads answer immediately, while writes
 * (index, delete, finalize, embed) go through `writes` and run one at a time.
 */
@Controller()
export class IndexingController {
  private readonly writes = new SerialQueue();

  constructor(private readonly indexingService: IndexingService) {}

  /** Fire-and-forget: a large book can take longer than an RPC timeout. */
  @EventPattern(PATTERNS.INDEXING.PROCESS_BOOK)
  async processBook(
    @Payload() dto: ProcessBookIndexDto,
    @Ctx() ctx: RmqContext,
  ) {
    try {
      // Shows as "Queued" until earlier jobs finish and this one starts.
      await this.indexingService.markQueued(dto);
      await this.writes.run(() => this.indexingService.indexBook(dto));
    } finally {
      ack(ctx);
    }
  }

  @EventPattern(PATTERNS.INDEXING.DELETE_BOOK)
  async deleteBook(
    @Payload() dto: { bookId?: string },
    @Ctx() ctx: RmqContext,
  ) {
    try {
      await this.writes.run(() => this.indexingService.deleteBook(dto));
    } finally {
      ack(ctx);
    }
  }

  @MessagePattern(PATTERNS.INDEXING.GET_STATUSES)
  async getStatuses(@Payload() bookIds: string[], @Ctx() ctx: RmqContext) {
    try {
      return await this.indexingService.getStatuses(bookIds);
    } finally {
      ack(ctx);
    }
  }

  @MessagePattern(PATTERNS.INDEXING.GET_STATUS)
  async getStatus(@Payload() bookId: string, @Ctx() ctx: RmqContext) {
    try {
      return await this.indexingService.getStatus(bookId);
    } finally {
      ack(ctx);
    }
  }

  @MessagePattern(PATTERNS.INDEXING.GET_STATS)
  async getStats(@Ctx() ctx: RmqContext) {
    try {
      return await this.indexingService.getStats();
    } finally {
      ack(ctx);
    }
  }

  @MessagePattern(PATTERNS.INDEXING.FINALIZE)
  async finalize(@Ctx() ctx: RmqContext) {
    try {
      return await this.writes.run(() => this.indexingService.finalize());
    } finally {
      ack(ctx);
    }
  }

  @MessagePattern(PATTERNS.INDEXING.EMBED_BOOK)
  async embedBook(@Payload() dto: EmbedBookDto, @Ctx() ctx: RmqContext) {
    try {
      return await this.writes.run(() => this.indexingService.embedBook(dto));
    } finally {
      ack(ctx);
    }
  }
}

function ack(ctx: RmqContext) {
  const channel = ctx.getChannelRef() as { ack(msg: unknown): void };
  channel.ack(ctx.getMessage());
}

/** Runs async jobs one after another, in arrival order. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job);
    // Keep the chain alive whether or not this job fails.
    this.tail = result.catch(() => undefined);
    return result;
  }
}
