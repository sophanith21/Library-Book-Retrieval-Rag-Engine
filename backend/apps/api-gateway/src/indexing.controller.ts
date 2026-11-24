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
} from '@nestjs/common';
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
import { firstValueFrom, timeout } from 'rxjs';

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
    return firstValueFrom(
      this.client
        .send<IndexStatsResponse>(PATTERNS.INDEXING.FINALIZE, {})
        .pipe(timeout(10 * 60_000)),
    );
  }

  /** Generate/backfill dense pgvector embeddings for unembedded chunks. */
  @Post('embed')
  embedBatch(@Body() dto?: EmbedBookDto): Promise<EmbedBookResponse> {
    return firstValueFrom(
      this.client
        .send<EmbedBookResponse>(PATTERNS.INDEXING.EMBED_BOOK, dto ?? {})
        .pipe(timeout(10 * 60_000)),
    );
  }

  /** Generate/backfill dense pgvector embeddings for a specific book. */
  @Post(':bookId/embed')
  embedBook(@Param('bookId') bookId: string): Promise<EmbedBookResponse> {
    return firstValueFrom(
      this.client
        .send<EmbedBookResponse>(PATTERNS.INDEXING.EMBED_BOOK, { bookId })
        .pipe(timeout(10 * 60_000)),
    );
  }

  @Get(':bookId')
  getStatus(@Param('bookId') bookId: string): Promise<BookIndexStatus> {
    return firstValueFrom(
      this.client
        .send<BookIndexStatus>(PATTERNS.INDEXING.GET_STATUS, bookId)
        .pipe(timeout(10_000)),
    );
  }
}
