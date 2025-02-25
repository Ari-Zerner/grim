# Zeroplayer Grim Simulation

This utility autonomously plays a Grim wargame scenario to uncover novel global catastrophic risks. It uses AI-generated players representing real-world entities and gives the AI full autonomy to explore the scenario—determining when to continue, branch, or end the simulation based on emerging risks.

## Features

- AI-driven simulation with full autonomy over round progression
- No fixed number of rounds; the AI decides when to conclude the simulation
- Automatically generates players representing real-world entities (governments, corporations, organizations)
- Dynamic branching based on AI's assessment of the simulation state
- AI-generated reports at any point during the simulation when novel risks are identified
- Multiple report types (Risk Assessment, Escalation Analysis, etc.) that the AI can generate at its discretion
- Meta-analysis synthesizing insights from all generated reports
- Saves all outputs to a specified directory for review

## Setup

1. Ensure you have the necessary environment variables set:
   - `OPENAI_API_KEY` (for AI interactions)

2. Install dependencies:
   ```
   bun install
   ```
   
## Running the Simulation

From the project root, run the simulation with:

```
bun src/zeroplayer/main.ts --scenario-file=path/to/scenario.txt --output-dir=./reports
```

### Command Line Options

- `--scenario-file` (required): Path to the scenario file
- `--output-dir` (optional): Directory to save output reports (default: './reports')
- `--branch-exploration` (optional): Whether to explore alternative branches (default: true)
- `--overwrite-reports` (optional): Whether to overwrite existing reports directory (default: false)

## Output Files

The simulation generates several output files in the specified directory:

- `simulation_plan.json`: The AI-generated initial plan for the simulation (for reference)
- `players.json`: The list of players (real-world entities) in the simulation
- `initial_briefing.md`: The initial scenario briefing
- `round_X_response.md`: Responses from each simulation round
- `report_main_rX_[report_type].md`: Reports generated during the main branch simulation
- `branch_from_rX_round_Y_response.md`: Responses for branch rounds
- `report_branch_from_rX_rY_[report_type].md`: Reports generated during branch simulations
- `report_main_final_[report_type].md`: Final report for the main branch
- `report_branch_from_rX_final_[report_type].md`: Final reports for branch simulations
- `meta_analysis.md`: A comprehensive meta-analysis synthesizing insights from all reports

## How It Works

1. The system loads a scenario from the specified file.
2. An initial simulation plan is generated for reference, but the AI controls the progression.
3. Real-world entities are generated as simulation actors.
4. The simulation loop runs autonomously; after each round, the AI decides whether to continue.
5. The AI dynamically decides whether to branch into alternative simulations based on emerging risks.
6. Risk reports are generated at any point the AI identifies novel risks.
7. A final report and meta-analysis are generated once the simulation concludes.

The system is designed for creative, open-ended exploration, allowing the AI to uncover global-scale risks without being constrained by a preset number of rounds.
