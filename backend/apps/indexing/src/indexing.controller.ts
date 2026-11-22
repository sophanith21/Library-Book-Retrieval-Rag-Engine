import { Controller } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { PATTERNS, ProcessBookIndexDto } from '@app/contracts';
import { IndexingService } from './indexing.service';

/**
 * RabbitMQ handlers. The queue runs with manual acks and prefetch 1 (see
 * main.ts), so books are indexed one at a time and a message is only removed
 * from the queue once its book is written (or its failure recorded).
 */
@Controller()
export class IndexingController {
  constructor(private readonly indexingService: IndexingService) {}

  /** Fire-and-forget: a large book can take longer than an RPC timeout. */
  @EventPattern(PATTERNS.INDEXING.PROCESS_BOOK)
  async processBook(
    @Payload() dto: ProcessBookIndexDto,
    @Ctx() ctx: RmqContext,
  ) {
    try {
      await this.indexingService.indexBook(dto);
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

  @MessagePattern(PATTERNS.INDEXING.FINALIZE)
  async finalize(@Ctx() ctx: RmqContext) {
    try {
      return await this.indexingService.finalize();
    } finally {
      ack(ctx);
    }
  }
}

function ack(ctx: RmqContext) {
  const channel = ctx.getChannelRef() as { ack(msg: unknown): void };
  channel.ack(ctx.getMessage());
}
