import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  BookFileUrlResponse,
  BookItem,
  BookListResponse,
  CategoryCount,
  CreateBookDto,
  DeleteBookResponse,
  ListBooksQueryDto,
  PATTERNS,
  UpdateBookMessage,
  UploadBookMessage,
  UploadBookResponse,
} from '@app/contracts';
import { BookService } from './book.service';

@Controller()
export class BookController {
  constructor(private readonly bookService: BookService) {}

  @MessagePattern(PATTERNS.BOOK.FIND_ALL)
  findAll(@Payload() dto: ListBooksQueryDto): Promise<BookListResponse> {
    return this.bookService.findAll(dto ?? {});
  }

  @MessagePattern(PATTERNS.BOOK.FIND_BY_ID)
  findById(@Payload() id: string): Promise<BookItem> {
    return this.bookService.findById(id);
  }

  @MessagePattern(PATTERNS.BOOK.CATEGORIES)
  categories(): Promise<CategoryCount[]> {
    return this.bookService.categories();
  }

  @MessagePattern(PATTERNS.BOOK.GET_FILE_URL)
  getFileUrl(@Payload() id: string): Promise<BookFileUrlResponse> {
    return this.bookService.getFileUrl(id);
  }

  @MessagePattern(PATTERNS.BOOK.CREATE)
  create(@Payload() dto: CreateBookDto): Promise<BookItem> {
    return this.bookService.create(dto);
  }

  @MessagePattern(PATTERNS.BOOK.UPDATE)
  update(@Payload() msg: UpdateBookMessage): Promise<BookItem> {
    return this.bookService.update(msg?.id, msg?.patch);
  }

  @MessagePattern(PATTERNS.BOOK.DELETE)
  delete(@Payload() id: string): Promise<DeleteBookResponse> {
    return this.bookService.delete(id);
  }

  @MessagePattern(PATTERNS.BOOK.UPLOAD)
  upload(@Payload() msg: UploadBookMessage): Promise<UploadBookResponse> {
    return this.bookService.upload(msg);
  }

  @MessagePattern(PATTERNS.BOOK.REINDEX)
  reindex(@Payload() id: string): Promise<UploadBookResponse> {
    return this.bookService.reindex(id);
  }
}
