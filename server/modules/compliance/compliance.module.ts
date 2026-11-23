import { Module } from '@nestjs/common';
import { ProvenanceService } from './provenance.service';
import { ComplianceController } from './compliance.controller';

@Module({
  controllers: [ComplianceController],
  providers: [ProvenanceService],
  exports: [ProvenanceService],
})
export class ComplianceModule {}
