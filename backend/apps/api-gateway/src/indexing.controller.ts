import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { rpc } from './rpc-client';
import { ClientProxy } from '@nestjs/microservices';
import {
  BookIndexStatus,
  EmbedBookDto,
  EmbedBookResponse,
  IndexStatsResponse,
  PATTERNS,
  ProcessBookIndexDto,
  SERVICES,
} from '@app/contracts';
import { firstValueFrom } from 'rxjs';

@Controller('indexing')
export class IndexingGatewayController {
  constructor(
    @Inject(SERVICES.INDEXING) private readonly client: ClientProxy,
  ) {}

  /**
   * Queue a book for indexing. Returns 202 immediately; poll
   * GET /indexing/:bookId for the result.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async processBook(@Body() dto: ProcessBookIndexDto) {
    if (!dto?.bookId || !Array.isArray(dto.chapters)) {
      throw new BadRequestException('bookId and chapters[] are required');
    }
    await firstValueFrom(this.client.emit(PATTERNS.INDEXING.PROCESS_BOOK, dto));
    return { bookId: dto.bookId, status: 'queued' };
  }

  /** Recompute corpus statistics and BM25 weights after a bulk load. */
  @Post('finalize')
  finalize(): Promise<IndexStatsResponse> {
    return rpc<IndexStatsResponse>(
      this.client,
      PATTERNS.INDEXING.FINALIZE,
      {},
      { service: 'Indexing', timeoutMs: 10 * 60_000 },
    );
  }

  /** Generate/backfill dense pgvector embeddings for unembedded chunks. */
  @Post('embed')
  embedBatch(@Body() dto?: EmbedBookDto): Promise<EmbedBookResponse> {
    return rpc<EmbedBookResponse>(
      this.client,
      PATTERNS.INDEXING.EMBED_BOOK,
      dto ?? {},
      { service: 'Indexing', timeoutMs: 10 * 60_000 },
    );
  }

  /** Generate/backfill dense pgvector embeddings for a specific book. */
  @Post(':bookId/embed')
  embedBook(@Param('bookId') bookId: string): Promise<EmbedBookResponse> {
    return rpc<EmbedBookResponse>(
      this.client,
      PATTERNS.INDEXING.EMBED_BOOK,
      { bookId },
      { service: 'Indexing', timeoutMs: 10 * 60_000 },
    );
  }

  /** Current corpus statistics including dirtyBooks count since last finalize. */
  @Get('stats')
  getStats(): Promise<IndexStatsResponse> {
    return rpc<IndexStatsResponse>(
      this.client,
      PATTERNS.INDEXING.GET_STATS,
      {},
      { service: 'Indexing' },
    );
  }

  /** GET /indexing/status?ids=book-a,book-b (max 200) */
  @Get('status')
  getStatuses(@Query('ids') ids = ''): Promise<BookIndexStatus[]> {
    const bookIds = ids
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 200);
    return rpc<BookIndexStatus[]>(
      this.client,
      PATTERNS.INDEXING.GET_STATUSES,
      bookIds,
      { service: 'Indexing' },
    );
  }

  @Get(':bookId')
  getStatus(@Param('bookId') bookId: string): Promise<BookIndexStatus> {
    return rpc<BookIndexStatus>(
      this.client,
      PATTERNS.INDEXING.GET_STATUS,
      bookId,
      { service: 'Indexing' },
    );
  }
}
