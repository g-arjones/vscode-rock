import * as context from './context'
import * as wrappers from './wrappers'
import * as vscode from 'vscode'
import * as fs from 'fs'
import { basename, dirname, relative, join as joinpath } from 'path'
import * as async from './async'
import * as packages from './packages'
import * as autoproj from './autoproj'

export class Target
{
    private readonly _name: string;
    private readonly _path: string;

    constructor(name: string, path: string)
    {
        this._name = name;
        this._path = path;
    }

    get name(): string
    {
        return this._name;
    }

    get path(): string
    {
        return this._path;
    }
}

export class PreLaunchTaskProvider implements vscode.TaskProvider
{
    private readonly _vscode: wrappers.VSCode;
    private readonly _context: context.Context;

    constructor(context: context.Context, vscode: wrappers.VSCode)
    {
        this._vscode  = vscode;
        this._context = context;
    }

    static task(pkg: packages.Package, context: context.Context, vscode: wrappers.VSCode): vscode.Task | undefined
    {
        let ws = context.workspaces.folderToWorkspace.get(pkg.path)
        if (!ws) {
            throw new Error("package not in a workspace");
        }

        if (pkg.type.id === packages.TypeList.OROGEN.id)
        {
            return this.orogenTask(ws, pkg, context, vscode);
        }
        else {
            return;
        }
    }
    static orogenTask(ws: autoproj.Workspace, pkg: packages.Package, context: context.Context, vscode: wrappers.VSCode): vscode.Task | undefined
    {
        let target = context.getDebuggingTarget(pkg.path);
        if (!target) {
            return;
        }

        let args = ['exec', 'rock-run'];
        let folder = vscode.getWorkspaceFolder(pkg.path) as vscode.WorkspaceFolder;
        let taskName = "Run " + relative(ws.root, pkg.path);
        taskName = taskName + " (gdbserver)";

        let userConf = context.debugConfig(pkg.path);
        if (userConf.orogen.start) args.push('--start');
        if (userConf.orogen.gui) args.push('--gui');
        args.push('--gdbserver');
        if (userConf.orogen.confDir)
        {
            args.push('--conf-dir');
            args.push(userConf.orogen.confDir);
        }
        args.push(target.name);

        return this.createTask(taskName, folder, ws, userConf.cwd, args);
    }

    private static runAutoproj(ws: autoproj.Workspace, cwd: string | undefined, ...args) {
        return new vscode.ProcessExecution(ws.autoprojExePath(), args, { cwd: cwd })
    }

    private static createTask(name: string, target: vscode.WorkspaceFolder, ws: autoproj.Workspace, cwd: string | undefined, args : string[] = []) {
        let definition = { type: 'rock', workspace: ws.root }
        let exec = this.runAutoproj(ws, cwd, ...args);
        let folder = context
        let task = new vscode.Task(definition, target, name, 'rock', exec, []);
        return task;
    }

    async provideTasks(token?: vscode.CancellationToken): Promise<vscode.Task[]>
    {
        let pkg = await this._context.getSelectedPackage();
        if (!pkg.type.isValid()) {
            return [];
        }

        let task = PreLaunchTaskProvider.task(pkg, this._context, this._vscode)
        if (task) {
            return [task];
        }
        else {
            return [];
        }
    }

    resolveTask(task: vscode.Task, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.Task>
    {
        return null;
    }
}

class ConfigurationProvider implements vscode.DebugConfigurationProvider
{
    private _context : context.Context;

    constructor(context : context.Context) {
        this._context = context;
    }

    provideDebugConfigurations(folder : vscode.WorkspaceFolder | undefined, token : vscode.CancellationToken | undefined) : vscode.ProviderResult<vscode.DebugConfiguration[]>
    {
        return [];
    }

    async resolveDebugConfiguration(folder : vscode.WorkspaceFolder | undefined, config : vscode.DebugConfiguration, token : vscode.CancellationToken | undefined) : Promise<vscode.DebugConfiguration>
    {
        return config;
    }

    protected async resolvePackage(folder: vscode.WorkspaceFolder | undefined) : Promise<packages.RockPackage | undefined>
    {
        if (!folder) {
            return;
        }
        let pkg = await this._context.getPackageByPath(folder.uri.fsPath);
        if (pkg instanceof packages.RockPackage) {
            return pkg;
        }
    }
}

export class CXXConfigurationProvider extends ConfigurationProvider
{
    provideDebugConfigurations(folder : vscode.WorkspaceFolder | undefined, token : vscode.CancellationToken | undefined) : vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return [];
    }

    async resolveDebugConfiguration(folder : vscode.WorkspaceFolder | undefined, config : vscode.DebugConfiguration, token : vscode.CancellationToken | undefined) : Promise<vscode.DebugConfiguration>
    {
        let pkg = await this.resolvePackage(folder);
        if (!pkg) {
            return config;
        }

        let ws = pkg.ws;

        let debuggerPath = config.miDebuggerPath || config.MIMode;
        let stubScript = joinpath(__dirname, '..', 'stubs', config.MIMode);

        config.miDebuggerPath = stubScript;
        if (!config.environment) {
            config.environment = [];
        }
        config.environment = config.environment.concat([
            { name: "VSCODE_ROCK_AUTOPROJ_PATH", value: ws.autoprojExePath() },
            { name: "VSCODE_ROCK_AUTOPROJ_DEBUGGER", value: debuggerPath },
            { name: 'AUTOPROJ_CURRENT_ROOT', value: ws.root }
        ])

        if (!fs.existsSync(config.program)) {
            let search = [pkg.info.builddir, pkg.info.prefix,
                joinpath(pkg.info.builddir, 'test'),
                joinpath(pkg.info.builddir, 'src'),
                joinpath(pkg.info.prefix, 'bin')]
            let foundPath = search.find((dir) => {
                return fs.existsSync(joinpath(dir, config.program));
            })
            if (foundPath) {
                config.program = joinpath(foundPath, config.program);
            }
        }
        if (!config.cwd) {
            config.cwd = dirname(config.program);
        }
        return config;
    }
}

export class RubyConfigurationProvider extends ConfigurationProvider
{
    async resolveDebugConfiguration(folder : vscode.WorkspaceFolder | undefined, config : vscode.DebugConfiguration, token : vscode.CancellationToken | undefined) : Promise<vscode.DebugConfiguration>
    {
        let pkg = await this.resolvePackage(folder);
        if (!pkg) {
            return config;
        }
        let ws = pkg.ws;

        config.useBundler = true;
        config.pathToBundler = ws.autoprojExePath();
        if (!config.env) {
            config.env = {}
        }
        config.env.AUTOPROJ_CURRENT_ROOT = ws.root;
        config.program = await ws.which(config.program);
        return config;
    }
}
