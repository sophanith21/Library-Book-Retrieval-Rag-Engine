import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  BookFileUrlResponse,
  BookItem,
  BookListResponse,
  CategoryCount,
  CreateBookDto,
  DeleteBookResponse,
  ListBooksQueryDto,
  PATTERNS,
  SERVICES,
  UpdateBookDto,
  UploadBookResponse,
} from '@app/contracts';
import { AdminOnly, Authenticated } from './auth.guard';
import { rpc } from './rpc-client';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface UploadedEpub {
  originalname: string;
  size: number;
  buffer: Buffer;
}

const optionalNumber = (v?: string) =>
  v === undefined || v === '' ? undefined : Number(v);

@ApiTags('books')
@Controller('books')
export class BooksGatewayController {
  constructor(@Inject(SERVICES.BOOK) private readonly client: ClientProxy) {}

  /** GET /books?q=melville&category=Fiction&sort=title&limit=24&offset=0 */
  @Get()
  @ApiOperation({ summary: 'Browse the catalogue' })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Title or author contains',
  })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['title', 'author', 'newest'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiOkResponse({ type: BookListResponse })
  findAll(
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<BookListResponse> {
    const dto: ListBooksQueryDto = {
      q,
      category,
      sort: sort === 'author' || sort === 'newest' ? sort : 'title',
      limit: optionalNumber(limit),
      offset: optionalNumber(offset),
    };
    return this.send(PATTERNS.BOOK.FIND_ALL, dto);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Categories with book counts' })
  @ApiOkResponse({ type: [CategoryCount] })
  categories(): Promise<CategoryCount[]> {
    return this.send(PATTERNS.BOOK.CATEGORIES, {});
  }

  @Get(':id')
  @ApiOkResponse({ type: BookItem })
  findById(@Param('id') id: string): Promise<BookItem> {
    return this.send(PATTERNS.BOOK.FIND_BY_ID, id);
  }

  /** Short-lived download link for the EPUB (signed-in users). */
  @Get(':id/file')
  @Authenticated()
  @ApiOkResponse({ type: BookFileUrlResponse })
  fileUrl(@Param('id') id: string): Promise<BookFileUrlResponse> {
    return this.send(PATTERNS.BOOK.GET_FILE_URL, id);
  }

  /** Register or update metadata only (no file). */
  @Post()
  @AdminOnly()
  @ApiOkResponse({ type: BookItem })
  create(@Body() dto: CreateBookDto): Promise<BookItem> {
    return this.send(PATTERNS.BOOK.CREATE, dto);
  }

  /** Upload an EPUB: stored, registered and queued for indexing. */
  @Post('upload')
  @AdminOnly()
  @ApiOperation({ summary: 'Upload an EPUB (multipart field "file")' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: UploadBookResponse })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  upload(@UploadedFile() file?: UploadedEpub): Promise<UploadBookResponse> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Attach an .epub file in the "file" field');
    }
    if (!/\.epub$/i.test(file.originalname)) {
      throw new BadRequestException('Only .epub files are supported');
    }
    return this.send(
      PATTERNS.BOOK.UPLOAD,
      {
        filename: file.originalname,
        contentBase64: file.buffer.toString('base64'),
      },
      120_000,
    );
  }

  @Post(':id/reindex')
  @AdminOnly()
  @ApiOkResponse({ type: UploadBookResponse })
  reindex(@Param('id') id: string): Promise<UploadBookResponse> {
    return this.send(PATTERNS.BOOK.REINDEX, id, 120_000);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOkResponse({ type: BookItem })
  update(
    @Param('id') id: string,
    @Body() patch: UpdateBookDto,
  ): Promise<BookItem> {
    return this.send(PATTERNS.BOOK.UPDATE, { id, patch: patch ?? {} });
  }

  @Delete(':id')
  @AdminOnly()
  @ApiOkResponse({ type: DeleteBookResponse })
  remove(@Param('id') id: string): Promise<DeleteBookResponse> {
    return this.send(PATTERNS.BOOK.DELETE, id);
  }

  private send<T>(
    pattern: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    return rpc<T>(this.client, pattern, payload, {
      service: 'Book',
      timeoutMs,
    });
  }
}
