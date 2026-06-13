import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { LocalStorageAdapter } from './storage/local-storage.adapter';
import { OssStorageAdapter } from './storage/oss-storage.adapter';
import { STORAGE_ADAPTER } from './storage/storage.adapter';
import { StorageDownloadController, UploadController } from './upload.controller';
import { UploadService } from './upload.service';

@Module({
  controllers: [UploadController, StorageDownloadController],
  providers: [
    UploadService,
    {
      provide: STORAGE_ADAPTER,
      inject: [ConfigService, REDIS],
      useFactory: (cfg: ConfigService, redis: Redis) => {
        const driver = cfg.get<string>('STORAGE_DRIVER', 'local');
        if (driver === 'oss') return new OssStorageAdapter();
        return new LocalStorageAdapter(
          redis,
          cfg.get<string>('UPLOAD_ROOT', './storage'),
          cfg.get<string>('UPLOAD_PUBLIC_BASE', `http://127.0.0.1:${cfg.get('PORT', '3000')}`),
        );
      },
    },
  ],
})
export class UploadModule {}
