// Entry point for the chaosclaw CLI — builds the commander program and hands off to it
import { buildProgram } from './cli/program.js'

const program = buildProgram()
// process.argv includes 'node' and the script path as the first two elements;
// commander expects them to be present for correct argument parsing
program.parse(process.argv)
