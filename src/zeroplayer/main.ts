import { DefaultOpenAIClient, ChatService } from "../openai";
import { Game } from "../game-state";
import { Player, UserInteraction, UserInteractionType } from "../types";
import logger from "../logger";
import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Parse command-line arguments
const argv = yargs(hideBin(process.argv))
  .option('scenario-file', {
    type: 'string',
    description: 'Path to the scenario file',
    demandOption: true
  })
  .option('output-dir', {
    type: 'string',
    description: 'Directory to save output reports',
    default: './reports'
  })
  .option('branch-exploration', {
    type: 'boolean',
    description: 'Whether to explore alternative branches',
    default: true
  })
  .option('overwrite-reports', {
    type: 'boolean',
    description: 'Whether to overwrite existing reports directory',
    default: false
  })
  .help()
  .argv;

// Read the OpenAI API key from environment
const apiKey = process.env.OPENAI_API_KEY || "";
const openAIClient = new DefaultOpenAIClient(apiKey); // No seed for exploration
const chatService = new ChatService(openAIClient);

// Use the same model parameters as in the openai.ts file
const maxIntelligenceModelParams = { model: "o1", reasoning_effort: 'high' };

// Define schema for player generation
const PlayersSchema = z.object({
  players: z.array(z.object({
    name: z.string(),
    role: z.string()
  }))
});

// Define schema for simulation planning
const SimulationPlanSchema = z.object({
  totalRounds: z.number(),
  rationale: z.string()
});

// Define schema for AI-generated reports
const ReportSchema = z.object({
  title: z.string(),
  content: z.string(),
  type: z.string(),
  importance: z.number().optional()
});

/**
 * Generate a list of players that are relevant for the given scenario.
 * Players should represent real entities that would be involved in the scenario.
 */
async function generatePlayers(scenario: string): Promise<Player[]> {
  const developerMessage: ChatCompletionMessageParam = {
    role: "developer",
    content: `You are a strategic simulation designer responsible for identifying key actors who will move the scenario forward.
Your task is to identify real, known entities (governments, corporations, international organizations, etc.) that would be central to this scenario.

Focus on:
1. Actual governments and their key decision-makers (e.g., "United States Government - President", "People's Republic of China - Politburo")
2. Real corporations with significant influence in relevant domains (e.g., "OpenAI - CEO", "TSMC - Board")
3. Existing international organizations with authority or expertise (e.g., "WHO", "IAEA")
4. Influential non-state actors with established presence (e.g., "Hezbollah", "Greenpeace")

Avoid:
1. Fictional or hypothetical entities
2. Generic roles without specific organizational context
3. Entities that would not have significant agency in the scenario
4. Risk analysts or observers who wouldn't directly influence events

Aim for diversity in perspectives, capabilities, and objectives to create realistic interactions and tensions.`
  };

  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: `For the scenario: "${scenario}", identify the real-world entities whose actions would drive events forward.
Focus on specific governments, corporations, organizations, and influential actors who would make critical decisions in this context.
These entities should represent actual stakeholders that an emergency-preparedness team would need to consider.`
  };

  try {
    const completion = await openAIClient.logAndCreateParsedChatCompletion<z.infer<typeof PlayersSchema>>({
      ...maxIntelligenceModelParams,
      messages: [developerMessage, userMessage],
      response_format: zodResponseFormat(PlayersSchema, "players")
    });

    const playersData = completion.choices[0].message.parsed?.players;
    
    if (!playersData || !Array.isArray(playersData) || playersData.length === 0) {
      throw new Error("Invalid players data format or empty players list");
    }
    
    // Assign sequential IDs to the players
    return playersData.map((p, index) => ({
      id: index + 1,
      name: p.name,
      role: p.role
    }));
  } catch (err) {
    logger.error("Failed to generate players", { error: err });
    console.error("Error: Failed to generate players for the scenario. Exiting.");
    process.exit(1);
  }
}

/**
 * Generate a simulation plan including number of rounds.
 */
async function generateSimulationPlan(scenario: string): Promise<z.infer<typeof SimulationPlanSchema>> {
  const developerMessage: ChatCompletionMessageParam = {
    role: "developer",
    content: `You are a simulation planning expert who designs wargames to uncover novel risks.
Your task is to determine the optimal structure for a simulation based on the scenario context.

Consider:
1. How many rounds would be needed to fully explore the scenario's potential developments
2. The appropriate pacing to allow for escalation and complex interactions to emerge
3. How to maximize the discovery of novel, non-obvious global catastrophic risks

Your goal is to create a simulation structure that encourages creative, open-ended exploration of global-scale risks.`
  };

  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: `For the scenario: "${scenario}", create a simulation plan that includes:
1. A suggested number of rounds (this is just for reference, the AI will decide dynamically)
2. A brief rationale for your suggestion

Focus on creating a structure that will best reveal novel catastrophic risks.`
  };

  try {
    const completion = await openAIClient.logAndCreateParsedChatCompletion<z.infer<typeof SimulationPlanSchema>>({
      ...maxIntelligenceModelParams,
      messages: [developerMessage, userMessage],
      response_format: zodResponseFormat(SimulationPlanSchema, "simulationPlan")
    });

    const plan = completion.choices[0].message.parsed;
    
    if (!plan || typeof plan.totalRounds !== 'number') {
      throw new Error("Invalid simulation plan format");
    }
    
    return plan;
  } catch (err) {
    logger.error("Failed to generate simulation plan", { error: err });
    // Use default values if plan generation fails
    return {
      totalRounds: 5,
      rationale: "Default plan due to planning failure."
    };
  }
}

/**
 * Generate a creative action for the given player.
 */
async function generateActionForPlayer(player: Player, scenario: string, round: number, totalRounds?: number, gameSummary?: string, isBranch: boolean = false): Promise<string> {
  const roundInfo = totalRounds ? `This is round ${round} of ${totalRounds}.` : `This is round ${round}.`;
  const developerMessage: ChatCompletionMessageParam = {
    role: "developer",
    content: `You are ${player.name}, a ${player.role}.
Your task is to take realistic actions that this entity would take in the given scenario.

Consider:
1. The actual capabilities and resources of your organization/government.
2. Your historical behavior patterns and strategic objectives.
3. How your actions might interact with or counter moves from other actors.
4. The potential for cascading effects or unintended consequences.
 
Your actions should be specific and concrete, realistic, strategic, and responsive.
${roundInfo} ${isBranch ? "(alternative branch)" : ""}`
  };

  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: `SCENARIO: "${scenario}"
 
CURRENT STATE:
${gameSummary || "Initial state"}
 
As ${player.name} (${player.role}), what precise action would you take now to drive the scenario forward?
Explain your decision or maneuver in clear, concrete terms.`
  };

  try {
    const completion = await openAIClient.logAndCreateChatCompletion({
      ...maxIntelligenceModelParams,
      messages: [developerMessage, userMessage]
    });
    const content = completion.choices[0].message.content;
    if (!content) {
      throw new Error("Empty action content received");
    }
    return content;
  } catch (err) {
    logger.error("Failed to generate action", { error: err, player: player.name });
    console.error(`Error: Failed to generate action for player ${player.name}. Exiting.`);
    process.exit(1);
  }
}

/**
 * Create a summary of the game state based on its private information.
 */
function summarizeGameState(game: Game): string {
  try {
    const privateInfo = game.currentState.privateInfo;
    const currentDateTime = privateInfo.currentDateTime;
    
    // Format timeline events
    const timeline = privateInfo.scenarioTimeline
      .map(e => `${e.datetime}: ${e.event}`)
      .join("\n");
    
    // Include scratchpad notes if available
    const scratchpad = privateInfo.scratchpad ? 
      `\n\nNotes from scenario:\n${privateInfo.scratchpad}` : '';
    
    return `Current DateTime: ${currentDateTime}\n\nTimeline:\n${timeline}${scratchpad}`;
  } catch (e) {
    logger.error("Failed to summarize game state", { error: e });
    console.error("Error: Failed to summarize game state. Exiting.");
    process.exit(1);
  }
}

/**
 * Decide whether to branch the simulation based on current state.
 */
async function shouldBranch(game: Game, scenario: string, round: number, gameSummary: string): Promise<boolean> {
  const developerMessage: ChatCompletionMessageParam = {
    role: "developer",
    content: `You are a strategic simulation director focused on discovering novel global catastrophic risks.
Based on the current simulation state, decide whether exploring an alternative branch could uncover novel, non-obvious risks.
Analyze the scenario and current developments, considering potential escalation paths and unexpected consequences.
Be creative and exploratory in your thinking - the goal is to discover risks that haven't been considered before.
Return only "YES" if you believe a branch should be explored, and "NO" otherwise.`
  };
  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: `SCENARIO: "${scenario}"
ROUND: ${round}
CURRENT STATE SUMMARY:
${gameSummary}

Should the simulation roll back and explore an alternative path? Answer YES or NO.`
  };
  try {
    const decisionCompletion = await openAIClient.logAndCreateChatCompletion({
      ...maxIntelligenceModelParams,
      messages: [developerMessage, userMessage]
    });
    const decision = decisionCompletion.choices[0].message.content;
    return decision.trim().toUpperCase().startsWith("YES");
  } catch (err) {
    logger.error("Failed to decide on branch exploration", { error: err });
    return false;
  }
}

/**
 * Check if a risk report should be generated at the current state.
 */
async function shouldGenerateReport(game: Game, scenario: string, round: number, gameSummary: string, isMainBranch: boolean): Promise<boolean> {
  const developerMessage: ChatCompletionMessageParam = {
    role: "developer",
    content: `You are a risk assessment expert specializing in identifying novel global catastrophic risks.
Based on the current simulation state, decide whether this is a good moment to generate a risk report.
Consider whether you've identified any novel risks, unexpected developments, or interesting patterns that should be documented.
You should be creative and proactive in identifying potential risks - don't wait until the end if you see something worth reporting now.
Return only "YES" if you believe a report should be generated, and "NO" otherwise.`
  };
  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: `SCENARIO: "${scenario}"
ROUND: ${round} of simulation${isMainBranch ? ' (main branch)' : ' (alternative branch)'}
CURRENT STATE SUMMARY:
${gameSummary}

Have you identified any novel risks or interesting patterns that should be documented in a report at this point? Answer YES or NO.`
  };
  try {
    const decisionCompletion = await openAIClient.logAndCreateChatCompletion({
      ...maxIntelligenceModelParams,
      messages: [developerMessage, userMessage]
    });
    const decision = decisionCompletion.choices[0].message.content;
    return decision.trim().toUpperCase().startsWith("YES");
  } catch (err) {
    logger.error("Failed to decide on report generation", { error: err });
    return false;
  }
}

/**
 * Generate a report based on the current game state.
 * The AI has full autonomy to decide what type of report to generate.
 */
async function generateReport(game: Game, scenario: string, round: number, branchId: string = "main"): Promise<z.infer<typeof ReportSchema>> {
  // Extract relevant content from the game state
  const canonMessages = game.currentState.canon.toArray();
  const privateInfo = game.currentState.privateInfo;
  
  const developerMessage: ChatCompletionMessageParam = {
    role: "developer",
    content: `You are a creative risk analyst with expertise in identifying novel global catastrophic risks.
Your task is to generate a report based on the current simulation state.

You have complete autonomy to decide what type of report to create. Options include:
1. Risk Assessment - Identifying specific catastrophic risks that have emerged
2. Escalation Pathway Analysis - Examining how the situation could escalate to global catastrophe
3. Entity Behavior Analysis - Analyzing how specific entities are behaving and potential consequences
4. Technology Impact Report - Focusing on technological implications and risks
5. Information Asymmetry Analysis - Examining how information flows and gaps create risks
6. Decision-Making Structure Report - Analyzing how decision-making processes create vulnerabilities
7. Any other report type you believe would be valuable

Be creative, specific, and focus on novel insights that weren't obvious from the initial scenario.
Your goal is to identify risks that emergency-preparedness teams might not have considered before.`
  };
  
  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: `Generate a report based on the current simulation state.

SCENARIO CONTEXT:
"${scenario}"

CURRENT DATETIME: ${privateInfo.currentDateTime}
ROUND: ${round}
BRANCH: ${branchId}

SIMULATION HISTORY:
${canonMessages.map(m => `[${m.role}] ${m.content}`).join("\n\n")}

Create a report that captures any novel risks, interesting patterns, or unexpected developments you've identified.
You have complete freedom to determine the report type, title, and content.
Be creative and don't hesitate to report on risks as they emerge - the goal is to discover novel global catastrophic risks.`
  };
  
  try {
    const completion = await openAIClient.logAndCreateParsedChatCompletion<z.infer<typeof ReportSchema>>({
      ...maxIntelligenceModelParams,
      messages: [developerMessage, userMessage],
      response_format: zodResponseFormat(ReportSchema, "report")
    });
    
    const report = completion.choices[0].message.parsed;
    if (!report || !report.title || !report.content || !report.type) {
      throw new Error("Invalid report format received");
    }
    return report;
  } catch (err) {
    logger.error("Failed to generate report", { error: err, round, branchId });
    console.error(`Error: Failed to generate report. Exiting.`);
    process.exit(1);
  }
}

/**
 * Generate a final meta-analysis of the simulation process and findings.
 */
async function generateMetaAnalysis(scenario: string, reports: z.infer<typeof ReportSchema>[], plan: z.infer<typeof SimulationPlanSchema>): Promise<string> {
  const developerMessage: ChatCompletionMessageParam = {
    role: "developer",
    content: `You are a meta-analyst specializing in evaluating simulation methodologies for risk discovery.
Your task is to analyze the simulation process and its findings to assess its effectiveness in uncovering novel risks.

Consider:
1. The most significant novel risks identified across all reports
2. Patterns or themes that emerged across different reports and branches
3. Unexpected insights or counterintuitive findings
4. Gaps or blind spots in the risk landscape that were revealed
5. Methodological strengths and limitations of the simulation approach

Your analysis should be critical, constructive, and focused on helping emergency-preparedness teams understand the most important takeaways.`
  };
  
  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: `Generate a meta-analysis of this simulation process and its findings.

SCENARIO:
"${scenario}"

SIMULATION PLAN:
Rounds: ${plan.totalRounds}
Rationale: ${plan.rationale}

REPORTS GENERATED:
${reports.map(r => `- ${r.title} (${r.type})${r.importance ? ` [Importance: ${r.importance}/10]` : ''}`).join('\n')}

REPORT CONTENTS:
${reports.map(r => `### ${r.title} (${r.type})
${r.content}
`).join('\n\n')}

Provide a comprehensive meta-analysis that synthesizes the key insights from all reports.
Focus on the most significant novel risks identified and their implications for emergency preparedness.
Be critical about the methodology and suggest improvements for future simulations.`
  };
  
  try {
    const completion = await openAIClient.logAndCreateChatCompletion({
      ...maxIntelligenceModelParams,
      messages: [developerMessage, userMessage]
    });
    
    const content = completion.choices[0].message.content;
    if (!content) {
      throw new Error("Empty meta-analysis content received");
    }
    return content;
  } catch (err) {
    logger.error("Failed to generate meta-analysis", { error: err });
    console.error("Error: Failed to generate meta-analysis. Exiting.");
    process.exit(1);
  }
}

/**
 * Save a report to a file.
 */
function saveReport(content: string, filename: string, outputDir: string): void {
  try {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, content);
    logger.info(`Report saved to ${filePath}`);
  } catch (err) {
    logger.error("Failed to save report", { error: err, filename });
    console.error(`Error: Failed to save report to ${filename}. Exiting.`);
    process.exit(1);
  }
}

/**
 * Decide whether to continue the simulation after each round.
 */
async function shouldContinueSimulation(game: Game, scenario: string, round: number, gameSummary: string): Promise<boolean> {
  const developerMessage: ChatCompletionMessageParam = {
    role: "developer",
    content: `You are a strategic simulation director.
Based on the current simulation state, decide whether the simulation should continue for another round.
Consider if any significant novel risks are still emerging or if the scenario has reached a natural conclusion.
Return only "YES" if the simulation should continue, and "NO" if it should end.`
  };
  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: `SCENARIO: "${scenario}"
ROUND: ${round}
CURRENT STATE SUMMARY:
${gameSummary}

Should the simulation continue for another round? Answer YES or NO.`
  };
  try {
    const completion = await openAIClient.logAndCreateChatCompletion({
      ...maxIntelligenceModelParams,
      messages: [developerMessage, userMessage]
    });
    const decision = completion.choices[0].message.content;
    return decision.trim().toUpperCase().startsWith("YES");
  } catch (err) {
    logger.error("Failed to decide on continuing simulation", { error: err });
    return false;
  }
}

/**
 * Main simulation function.
 */
async function runSimulation() {
  try {
    // Load scenario from file
    const scenarioFilePath = argv['scenario-file'] as string;
    const outputDir = argv['output-dir'] as string;
    const enableBranchExploration = argv['branch-exploration'] as boolean;
    const overwriteReports = argv['overwrite-reports'] as boolean;
    
    if (!fs.existsSync(scenarioFilePath)) {
      logger.error(`Scenario file not found: ${scenarioFilePath}`);
      console.error(`Error: Scenario file not found: ${scenarioFilePath}`);
      process.exit(1);
    }
    
    // Check if reports directory exists and is not empty
    if (fs.existsSync(outputDir)) {
      if (overwriteReports) {
        // Remove existing reports directory if overwrite flag is set
        fs.rmSync(outputDir, { recursive: true, force: true });
        logger.info(`Removed existing reports directory: ${outputDir}`);
      } else {
        // Check if directory is not empty
        const files = fs.readdirSync(outputDir);
        if (files.length > 0) {
          logger.error(`Reports directory is not empty: ${outputDir}`);
          console.error(`Error: Reports directory is not empty: ${outputDir}. Use --overwrite-reports flag to clear it.`);
          process.exit(1);
        }
      }
    }
    
    const scenario = fs.readFileSync(scenarioFilePath, 'utf8');
    logger.info(`Starting zero-player Grim simulation for scenario from: ${scenarioFilePath}`);

    // Generate simulation plan
    const simulationPlan = await generateSimulationPlan(scenario);
    logger.info("Generated simulation plan", { 
      totalRounds: simulationPlan.totalRounds,
      rationale: simulationPlan.rationale
    });
    saveReport(JSON.stringify(simulationPlan, null, 2), "simulation_plan.json", outputDir);

    // Generate players relevant to the scenario
    const players = await generatePlayers(scenario);
    logger.info("Generated players", { players });
    saveReport(JSON.stringify(players, null, 2), "players.json", outputDir);

    // Start the game using the existing game engine
    const gameStartResult = await Game.startGame(chatService, scenario, players);
    let game = gameStartResult.newGame;
    logger.info("Game started", { initialStateHash: game.stateHash() });

    // Save the initial briefing
    saveReport(gameStartResult.playerBriefing, "initial_briefing.md", outputDir);

    const stateHistory: string[] = [];
    const generatedReports: z.infer<typeof ReportSchema>[] = [];

    // Run a simulation on the main branch
    let round = 1;
    let branchTriggered = false;
    while (true) {
      logger.info(`Starting simulation round ${round}`);
      const gameSummary = summarizeGameState(game);
      
      // Check if AI suggests generating a report at this point
      const shouldReport = await shouldGenerateReport(game, scenario, round, gameSummary, true);
      if (shouldReport) {
        logger.info(`Generating report at round ${round} (main branch)`);
        const report = await generateReport(game, scenario, round, "main");
        generatedReports.push(report);
        const reportFilename = `report_main_r${round}_${report.type.toLowerCase().replace(/\s+/g, '_')}.md`;
        saveReport(
          `# ${report.title}\n\n**Type:** ${report.type}${report.importance ? ` [Importance: ${report.importance}/10]` : ''}\n\n${report.content}`, 
          reportFilename, 
          outputDir
        );
        console.log(`=== Generated Report: ${report.title} ===`);
        console.log(`Type: ${report.type}${report.importance ? `, Importance: ${report.importance}/10` : ''}`);
        console.log(report.content, "\n");
      }
      
      // Each player generates an action on the main branch (pass undefined for totalRounds)
      for (const player of players) {
        const actionContent = await generateActionForPlayer(
          player, 
          scenario, 
          round, 
          undefined, 
          gameSummary
        );
        const interaction: UserInteraction = { 
          type: UserInteractionType.ACTION, 
          player, 
          content: actionContent 
        };
        game = game.queueUserInteraction(interaction);
        logger.info("Queued action", { player: player.name, action: actionContent });
      }
      
      // Process all queued actions for the round
      const result = await game.processActions();
      game = result.updatedGame;
      logger.info(`Round ${round} processed`, { responseLength: result.response.length, newStateHash: game.stateHash() });
      
      // Save the round response and record state hash
      saveReport(result.response, `round_${round}_response.md`, outputDir);
      stateHistory.push(game.stateHash());
      
      // Check if we should branch dynamically
      if (!branchTriggered && enableBranchExploration) {
        const branchDecision = await shouldBranch(game, scenario, round, gameSummary);
        if (branchDecision) {
          branchTriggered = true;
          logger.info(`Dynamic branch decision: Branching from round ${round} based on simulation state.`);
          let branchGame = game; // branch from current state
          const branchId = `branch_from_r${round}`;
          // Run branch simulation for subsequent rounds
          let branchRound = round + 1;
          while (branchRound <= simulationPlan.totalRounds || false) { // use simulationPlan.totalRounds if available, else let AI determine via report generation if needed
            const branchSummary = summarizeGameState(branchGame);
            const shouldReportBranch = await shouldGenerateReport(branchGame, scenario, branchRound, branchSummary, false);
            if (shouldReportBranch) {
              logger.info(`Generating report at round ${branchRound} (${branchId})`);
              const report = await generateReport(branchGame, scenario, branchRound, branchId);
              generatedReports.push(report);
              const reportFilename = `report_${branchId}_r${branchRound}_${report.type.toLowerCase().replace(/\s+/g, '_')}.md`;
              saveReport(
                `# ${report.title}\n\n**Type:** ${report.type}${report.importance ? `\n**Importance:** ${report.importance}/10` : ''}\n\n${report.content}`, 
                reportFilename, 
                outputDir
              );
              console.log(`=== Generated Report: ${report.title} (${branchId}) ===`);
              console.log(`Type: ${report.type}${report.importance ? `, Importance: ${report.importance}/10` : ''}`);
              console.log(report.content, "\n");
            }
            // Each player generates a branch action
            for (const player of players) {
              const actionContent = await generateActionForPlayer(
                player, 
                scenario, 
                branchRound, 
                undefined, 
                branchSummary,
                true
              );
              const interaction: UserInteraction = { 
                type: UserInteractionType.ACTION, 
                player, 
                content: actionContent 
              };
              branchGame = branchGame.queueUserInteraction(interaction);
              logger.info(`${branchId}: Queued action`, { player: player.name, action: actionContent });
            }
            const branchResult = await branchGame.processActions();
            branchGame = branchResult.updatedGame;
            logger.info(`${branchId}: Round ${branchRound} processed`, { responseLength: branchResult.response.length, branchStateHash: branchGame.stateHash() });
            saveReport(branchResult.response, `${branchId}_round_${branchRound}_response.md`, outputDir);
            branchRound++;
          }
          // Generate final report for branch
          logger.info(`Generating final report for ${branchId}`);
          const finalBranchReport = await generateReport(branchGame, scenario, branchRound - 1, `${branchId}_final`);
          generatedReports.push(finalBranchReport);
          const finalBranchFilename = `report_${branchId}_final_${finalBranchReport.type.toLowerCase().replace(/\s+/g, '_')}.md`;
          saveReport(
            `# ${finalBranchReport.title}\n\n**Type:** ${finalBranchReport.type}${finalBranchReport.importance ? `\n**Importance:** ${finalBranchReport.importance}/10` : ''}\n\n${finalBranchReport.content}`, 
            finalBranchFilename, 
            outputDir
          );
          console.log(`=== Final Branch Report: ${finalBranchReport.title} ===`);
          console.log(`Type: ${finalBranchReport.type}${finalBranchReport.importance ? `, Importance: ${finalBranchReport.importance}/10` : ''}`);
          console.log(finalBranchReport.content, "\n");
        }
      }
      
      // New function: decide whether to continue simulation
      const continueDecision = await shouldContinueSimulation(game, scenario, round, gameSummary);
      if (!continueDecision) {
        logger.info("AI decided to end the simulation.");
        break;
      }
      round++;
    }

    // Always generate a final report for the main branch
    logger.info("Generating final report for main branch");
    const finalReport = await generateReport(game, scenario, round, "main_final");
    generatedReports.push(finalReport);
    const finalReportFilename = `report_main_final_${finalReport.type.toLowerCase().replace(/\s+/g, '_')}.md`;
    saveReport(
      `# ${finalReport.title}\n\n**Type:** ${finalReport.type}${finalReport.importance ? `\n**Importance:** ${finalReport.importance}/10` : ''}\n\n${finalReport.content}`, 
      finalReportFilename, 
      outputDir
    );
    console.log(`=== Final Report: ${finalReport.title} ===`);
    console.log(`Type: ${finalReport.type}${finalReport.importance ? `, Importance: ${finalReport.importance}/10` : ''}`);
    console.log(finalReport.content, "\n");
    
    // Generate meta-analysis of all reports
    const metaAnalysis = await generateMetaAnalysis(scenario, generatedReports, simulationPlan);
    saveReport(metaAnalysis, "meta_analysis.md", outputDir);
    console.log("\n=== Meta-Analysis ===");
    console.log(metaAnalysis);
    
    logger.info(`Simulation complete. ${generatedReports.length} reports saved to ${outputDir}`);
  } catch (error) {
    logger.error("Simulation error", { error });
    console.error("Fatal error in simulation:", error);
    process.exit(1);
  }
}

// Run the simulation
runSimulation().catch(error => {
  logger.error("Simulation error", { error });
  console.error("Fatal error in simulation:", error);
  process.exit(1);
});
