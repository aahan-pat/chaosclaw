import { buildProgram } from './cli/program.js'

const program = buildProgram()
program.parse(process.argv)
