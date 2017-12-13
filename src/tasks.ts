'use strict';
import * as vscode from 'vscode';
import * as autoproj from './autoproj';
import * as path from 'path';

export class Provider implements vscode.TaskProvider
{
    workspaces : autoproj.Workspaces;

    private runAutoproj(ws, ...args) {
        return new vscode.ProcessExecution(ws.autoprojExePath(), args, { cwd: ws.root })
    }

    constructor(workspaces: autoproj.Workspaces)
    {
        this.workspaces = workspaces;
    }

    private createTask(name, group, problemMatchers, ws, defs = {}, args = []) {
        let definition = { type: 'autoproj', workspace: ws.root, ...defs }
        let exec = this.runAutoproj(ws, ...args);
        let task = new vscode.Task(definition, name, 'autoproj', exec, []);
        task.group = group;
        task.problemMatchers = problemMatchers;
        return task;
    }

    private createOsdepsTask(name, ws, defs = {}, args = []) {
        return this.createTask(name, null, null, ws,
            { mode: 'osdeps', ...defs },
            ['osdeps', '--color', ...args]);
    }

    private createBuildTask(name, ws, defs = {}, args = []) {
        return this.createTask(name, vscode.TaskGroup.Build, ['$autoproj-build'],
            ws, { mode: 'build', ...defs },
            ['build', '--tool', ...args]);
    }

    private createUpdateTask(name, ws, defs = {}, args = []) {
        return this.createTask(name, null, null, ws,
            { mode: 'update', ...defs },
            ['update', '--progress=f', '-k', '--color', ...args]);
    }

    private createUpdateConfigTask(name, ws, defs = {}, args = []) {
        return this.createUpdateTask(name, ws,
            { mode: 'update-config', ...defs },
            [ '--config', ...args]);
    }

    private createCheckoutTask(name, ws, defs = {}, args = []) {
        return this.createUpdateTask(name, ws,
            { mode: 'checkout', ...defs },
            ['--checkout-only', ...args]);
    }

    private createPackageBuildTask(name, ws, folder, defs = {}, args = []) {
        return this.createBuildTask(name, ws,
            { folder: folder, ...defs },
            [folder, ...args])
    }

    private createPackageForceBuildTask(name, ws, folder, defs = {}, args = []) {
        return this.createPackageBuildTask(name, ws, folder,
            { mode: 'force-build', ...defs },
            ['--force', '--deps=f', '--no-confirm', ...args]);
    }

    private createPackageUpdateTask(name, ws, folder, defs = {}, args = []) {
        return this.createUpdateTask(name, ws,
            { folder: folder, ...defs },
            [folder, ...args]);
    }

    private createPackageCheckoutTask(name, ws, folder, defs = {}, args = []) {
        return this.createPackageUpdateTask(name, ws,
            { mode: 'checkout', ...defs },
            ['--checkout-only', ...args]);
    }

    buildTaskName(folder): string
    {
        let ws = autoproj.Workspace.fromDir(folder);

        if (!ws)
            return null;

        let relative = path.relative(ws.root, folder);
        return `autoproj: ${ws.name}: Build ${relative}`;
    }

    provideTasks(token)
    {
        let result = [];
        this.workspaces.forEachWorkspace((ws) => {
            result.push(this.createBuildTask(`${ws.name}: Build`, ws));
            result.push(this.createCheckoutTask(`${ws.name}: Checkout`, ws));
            result.push(this.createOsdepsTask(`${ws.name}: Install OS Dependencies`, ws));
            result.push(this.createUpdateConfigTask(`${ws.name}: Update Configuration`, ws));
            result.push(this.createUpdateTask(`${ws.name}: Update`, ws));
        })
        this.workspaces.forEachFolder((ws, folder) => {
            if (folder == ws.root) { return; }
            let relative = path.relative(ws.root, folder);
            result.push(this.createPackageBuildTask(`${ws.name}: Build ${relative}`, ws, folder));
            result.push(this.createPackageCheckoutTask(`${ws.name}: Checkout ${relative}`, ws, folder));
            result.push(this.createPackageForceBuildTask(`${ws.name}: Force Build ${relative}`, ws, folder));
            result.push(this.createPackageUpdateTask(`${ws.name}: Update ${relative}`, ws, folder));
        })
        return result;
    }

    resolveTask(task, token)
    {
        return null;
    }
}