import { Module } from '@nestjs/common';
import { REPORTS_READER, ReportsService } from './application/reports.service';
import { PrismaReportsReader } from './infrastructure/prisma-reports.reader';
import { ReportsController } from './presentation/reports.controller';

@Module({
  controllers: [ReportsController],
  providers: [{ provide: REPORTS_READER, useClass: PrismaReportsReader }, ReportsService],
})
export class ReportsModule {}
