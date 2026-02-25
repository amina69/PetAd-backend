import { Module } from '@nestjs/common';
import { AdoptionController } from './adoption.controller';

@Module({
  controllers: [AdoptionController],
})
export class AdoptionModule {}
