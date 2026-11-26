import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { QUEUES, SERVICES } from '@app/contracts';
import { PrismaModule } from '@app/prisma';
import { BookController } from './book.controller';
import { BookService } from './book.service';
import { ObjectStorageService } from './storage/object-storage.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    PrismaModule,
    ClientsModule.register([
      {
        name: SERVICES.INDEXING,
        transport: Transport.RMQ,
        options: {
          urls: [
            process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
          ],
          queue: QUEUES.INDEXING,
          queueOptions: { durable: true },
        },
      },
    ]),
  ],
  controllers: [BookController],
  providers: [BookService, ObjectStorageService],
})
export class BookModule {}
