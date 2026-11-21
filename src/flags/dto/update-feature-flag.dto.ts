import { PartialType } from '@nestjs/swagger';
import { CreateFeatureFlagDto } from './create-feature-flag.dto';

export class UpdateFeatureFlagDto extends PartialType(CreateFeatureFlagDto) {}
