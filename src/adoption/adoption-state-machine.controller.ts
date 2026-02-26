import { Controller, Get, Param, Post, Body, ForbiddenException } from '@nestjs/common';
import { AdoptionStateMachine, AdoptionStatus } from './adoption-state-machine.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('adoption-state-machine')
@Controller('adoption-state-machine')
export class AdoptionStateMachineController {
  constructor(private readonly stateMachine: AdoptionStateMachine) {}

  @Get('transitions/:status')
  @ApiOperation({ summary: 'Get valid transitions for an adoption status' })
  @ApiResponse({ status: 200, description: 'Valid transitions returned' })
  getValidTransitions(@Param('status') status: AdoptionStatus) {
    try {
      const transitions = this.stateMachine.getValidTransitions(status);
      return {
        currentStatus: status,
        validTransitions: transitions,
        isTerminal: this.stateMachine.isTerminalStatus(status),
      };
    } catch (error) {
      throw new ForbiddenException(`Invalid status: ${status}`);
    }
  }

  @Post('validate')
  @ApiOperation({ summary: 'Validate a potential status transition' })
  @ApiResponse({ status: 200, description: 'Transition validation result' })
  validateTransition(@Body() body: { from: AdoptionStatus; to: AdoptionStatus; isAdmin?: boolean }) {
    const { from, to, isAdmin = false } = body;
    
    try {
      const isValid = isAdmin 
        ? this.stateMachine.canAdminOverride(from, to, true)
        : this.stateMachine.canTransition(from, to);

      return {
        from,
        to,
        isValid,
        isAdmin,
        message: isValid 
          ? 'Transition is valid' 
          : `Invalid transition: ${from} → ${to}. Valid options: ${this.stateMachine.getValidTransitions(from).join(', ')}`,
      };
    } catch (error) {
      return {
        from,
        to,
        isValid: false,
        isAdmin,
        message: error.message,
      };
    }
  }

  @Get('can-release-escrow/:adoptionId')
  @ApiOperation({ summary: 'Check if escrow can be released for an adoption' })
  @ApiResponse({ status: 200, description: 'Escrow release check result' })
  async canReleaseEscrow(@Param('adoptionId') adoptionId: string) {
    try {
      // This would typically require fetching the adoption from database
      // For now, return a placeholder response
      return {
        adoptionId,
        canRelease: false, // Placeholder - would check actual adoption status
        message: 'Escrow release check not implemented - requires adoption lookup',
      };
    } catch (error) {
      return {
        adoptionId,
        canRelease: false,
        message: error.message,
      };
    }
  }

  @Get('status-info')
  @ApiOperation({ summary: 'Get information about all adoption statuses' })
  @ApiResponse({ status: 200, description: 'Status information' })
  getStatusInfo() {
    return {
      statuses: Object.values(AdoptionStatus),
      terminalStates: [
        AdoptionStatus.COMPLETED,
        AdoptionStatus.REJECTED,
        AdoptionStatus.CANCELLED,
        AdoptionStatus.REFUNDED,
      ],
      escrowReleasableStates: [AdoptionStatus.ESCROW_FUNDED],
      completableStates: [AdoptionStatus.ESCROW_FUNDED],
      stateMachine: {
        primaryFlow: [
          'REQUESTED → PENDING_REVIEW → APPROVED → ESCROW_FUNDED → COMPLETED'
        ],
        alternativeFlows: [
          'REQUESTED → REJECTED',
          'PENDING_REVIEW → REJECTED', 
          'APPROVED → CANCELLED',
          'ESCROW_FUNDED → REFUNDED'
        ],
        invalidTransitions: [
          'COMPLETED → PENDING_REVIEW',
          'REJECTED → APPROVED',
          'REFUNDED → COMPLETED',
          'CANCELLED → APPROVED',
          'ESCROW_FUNDED → REQUESTED'
        ],
      },
    };
  }
}
