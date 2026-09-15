-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "leagueName" TEXT NOT NULL,
    "matchDate" TIMESTAMP(3) NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "pick" TEXT NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "odds" DOUBLE PRECISION,
    "oddsCapturedAt" TIMESTAMP(3),
    "closingOdds" DOUBLE PRECISION,
    "pickedTeamId" TEXT,
    "predictionTime" TIMESTAMP(3),
    "modelVersion" TEXT,
    "rawProbability" DOUBLE PRECISION,
    "inputsDigest" TEXT,
    "confidence" INTEGER NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastMatch" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "leagueName" TEXT NOT NULL,
    "kickoff" TIMESTAMP(3) NOT NULL,
    "homeTeamId" TEXT,
    "homeTeam" TEXT NOT NULL,
    "homeLogo" TEXT,
    "awayTeamId" TEXT,
    "awayTeam" TEXT NOT NULL,
    "awayLogo" TEXT,
    "espnState" TEXT,
    "statusDetail" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "league" TEXT NOT NULL,
    "leagueName" TEXT NOT NULL,
    "kickoff" TIMESTAMP(3) NOT NULL,
    "homeTeamId" TEXT,
    "homeTeam" TEXT NOT NULL,
    "homeLogo" TEXT,
    "awayTeamId" TEXT,
    "awayTeam" TEXT NOT NULL,
    "awayLogo" TEXT,
    "p1x2Home" DOUBLE PRECISION NOT NULL,
    "p1x2Draw" DOUBLE PRECISION NOT NULL,
    "p1x2Away" DOUBLE PRECISION NOT NULL,
    "pick1x2" TEXT NOT NULL,
    "pick1x2Label" TEXT NOT NULL,
    "pickedTeamId" TEXT,
    "confidence" INTEGER NOT NULL,
    "pOver25" DOUBLE PRECISION NOT NULL,
    "pUnder25" DOUBLE PRECISION NOT NULL,
    "pickOu25" TEXT NOT NULL,
    "pOver25Raw" DOUBLE PRECISION,
    "pUnder25Raw" DOUBLE PRECISION,
    "pBttsYes" DOUBLE PRECISION NOT NULL,
    "pBttsNo" DOUBLE PRECISION NOT NULL,
    "pickBtts" TEXT NOT NULL,
    "pBttsYesRaw" DOUBLE PRECISION,
    "pBttsNoRaw" DOUBLE PRECISION,
    "predictionTime" TIMESTAMP(3) NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "inputsDigest" TEXT,
    "odds1x2Home" DOUBLE PRECISION,
    "odds1x2Draw" DOUBLE PRECISION,
    "odds1x2Away" DOUBLE PRECISION,
    "oddsOver25" DOUBLE PRECISION,
    "oddsUnder25" DOUBLE PRECISION,
    "oddsBttsYes" DOUBLE PRECISION,
    "oddsBttsNo" DOUBLE PRECISION,
    "oddsCapturedAt" TIMESTAMP(3),
    "ouMarketLine" DOUBLE PRECISION,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchResult" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusDetail" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "winner" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ESPN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastEvaluation" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "grade1x2" TEXT,
    "gradeOu25" TEXT,
    "gradeBtts" TEXT,
    "resultKey" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastJobRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "phase" TEXT NOT NULL,
    "stats" TEXT,
    "error" TEXT,

    CONSTRAINT "ForecastJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "espnLeagueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "sport" TEXT NOT NULL DEFAULT 'soccer',
    "season" INTEGER,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "espnTeamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "abbreviation" TEXT,
    "logo" TEXT,
    "country" TEXT,
    "competition" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "espnEventId" TEXT NOT NULL,
    "competitionId" TEXT,
    "competitionName" TEXT,
    "season" INTEGER,
    "homeTeamId" TEXT,
    "homeTeamName" TEXT NOT NULL,
    "awayTeamId" TEXT,
    "awayTeamName" TEXT NOT NULL,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "statusDetail" TEXT,
    "espnState" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "venue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OddsSnapshot" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "marketType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "line" DOUBLE PRECISION,
    "odds" DOUBLE PRECISION NOT NULL,
    "bookmaker" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ESPN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OddsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotUid" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "competitionId" TEXT,
    "competition" TEXT,
    "season" INTEGER,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "homeTeamId" TEXT,
    "homeTeamName" TEXT NOT NULL,
    "awayTeamId" TEXT,
    "awayTeamName" TEXT NOT NULL,
    "predictionTime" TIMESTAMP(3) NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "inputsDigest" TEXT,
    "confidence" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'VOLTRIX',
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionMarket" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "marketKey" TEXT NOT NULL,
    "line" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionOutcome" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeKey" TEXT NOT NULL,
    "label" TEXT,
    "probability" DOUBLE PRECISION NOT NULL,
    "rawProbability" DOUBLE PRECISION,
    "pick" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionComponent" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "probabilities" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJobRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "phase" TEXT NOT NULL,
    "stats" TEXT,
    "error" TEXT,

    CONSTRAINT "SyncJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prediction_matchDate_idx" ON "Prediction"("matchDate");

-- CreateIndex
CREATE INDEX "Prediction_resolved_idx" ON "Prediction"("resolved");

-- CreateIndex
CREATE UNIQUE INDEX "Prediction_matchId_market_key" ON "Prediction"("matchId", "market");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastMatch_matchId_key" ON "ForecastMatch"("matchId");

-- CreateIndex
CREATE INDEX "ForecastMatch_kickoff_idx" ON "ForecastMatch"("kickoff");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_kickoff_idx" ON "ForecastSnapshot"("kickoff");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_matchId_idx" ON "ForecastSnapshot"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSnapshot_matchId_version_key" ON "ForecastSnapshot"("matchId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MatchResult_matchId_key" ON "MatchResult"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastEvaluation_matchId_key" ON "ForecastEvaluation"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_espnLeagueId_key" ON "Competition"("espnLeagueId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_espnTeamId_key" ON "Team"("espnTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_espnEventId_key" ON "Match"("espnEventId");

-- CreateIndex
CREATE INDEX "Match_kickoffAt_idx" ON "Match"("kickoffAt");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "Match_homeTeamId_idx" ON "Match"("homeTeamId");

-- CreateIndex
CREATE INDEX "Match_awayTeamId_idx" ON "Match"("awayTeamId");

-- CreateIndex
CREATE INDEX "Match_competitionId_idx" ON "Match"("competitionId");

-- CreateIndex
CREATE INDEX "Match_homeTeamId_awayTeamId_status_idx" ON "Match"("homeTeamId", "awayTeamId", "status");

-- CreateIndex
CREATE INDEX "OddsSnapshot_matchId_idx" ON "OddsSnapshot"("matchId");

-- CreateIndex
CREATE INDEX "OddsSnapshot_capturedAt_idx" ON "OddsSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "OddsSnapshot_matchId_marketType_outcome_idx" ON "OddsSnapshot"("matchId", "marketType", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionSnapshot_snapshotUid_key" ON "PredictionSnapshot"("snapshotUid");

-- CreateIndex
CREATE INDEX "PredictionSnapshot_matchId_idx" ON "PredictionSnapshot"("matchId");

-- CreateIndex
CREATE INDEX "PredictionSnapshot_kickoffAt_idx" ON "PredictionSnapshot"("kickoffAt");

-- CreateIndex
CREATE INDEX "PredictionSnapshot_predictionTime_idx" ON "PredictionSnapshot"("predictionTime");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionSnapshot_matchId_version_key" ON "PredictionSnapshot"("matchId", "version");

-- CreateIndex
CREATE INDEX "PredictionMarket_snapshotId_idx" ON "PredictionMarket"("snapshotId");

-- CreateIndex
CREATE INDEX "PredictionMarket_snapshotId_marketKey_idx" ON "PredictionMarket"("snapshotId", "marketKey");

-- CreateIndex
CREATE INDEX "PredictionOutcome_marketId_idx" ON "PredictionOutcome"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionOutcome_marketId_outcomeKey_key" ON "PredictionOutcome"("marketId", "outcomeKey");

-- CreateIndex
CREATE INDEX "PredictionComponent_marketId_idx" ON "PredictionComponent"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionComponent_marketId_component_key" ON "PredictionComponent"("marketId", "component");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionMarket" ADD CONSTRAINT "PredictionMarket_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PredictionSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionOutcome" ADD CONSTRAINT "PredictionOutcome_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "PredictionMarket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionComponent" ADD CONSTRAINT "PredictionComponent_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "PredictionMarket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

