import { Module } from '@nestjs/common';
import { HelpController } from './help.controller';

@Module({
  controllers: [HelpController],
})
export class HelpModule {}
