#!/usr/bin/env bash

# Verify that .dev.vars is not tracked by Git
if git ls-files --error-unmatch .dev.vars > /dev/null 2>&1; then
    echo "--------------------------------------------------------"
    echo "SECURITY ERROR: .dev.vars is being tracked by Git!"
    echo "Please run: git rm --cached .dev.vars"
    echo "Then ensure it is added to your .gitignore file."
    echo "--------------------------------------------------------"
    exit 1
fi
echo "Verification Success: .dev.vars is not tracked."