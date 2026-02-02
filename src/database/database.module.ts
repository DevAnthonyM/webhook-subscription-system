import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Database Module - Global module that provides database access
 *
 * @Global decorator makes this module available throughout the app
 * without needing to import it in every module
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
