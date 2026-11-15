import { Injectable } from '@nestjs/common';

@Injectable()
export class RetrievalService {
  getHello(): string {
    return 'Hello World!';
  }
}
