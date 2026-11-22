import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BadgeService } from './badge.service';

@ApiTags('Trust')
@Controller('trust/badges')
export class BadgesController {
  constructor(private readonly badgeService: BadgeService) {}

  /**
   * GET /trust/badges/:userId
   * Re-evaluates the rules and returns the user's current badges together
   * with the ledger event ids that justify each award.
   */
  @Get(':userId')
  @ApiOperation({
    summary: 'List a user’s badges with supporting event ids',
    description:
      'Rules are re-evaluated on read, so an award disappears as soon as its ' +
      'rule stops holding. Each badge lists the ledger events that justify it.',
  })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Awarded badges' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async listBadges(@Param('userId') userId: string) {
    const badges = await this.badgeService.evaluate(userId);
    return { userId, badges };
  }
}
