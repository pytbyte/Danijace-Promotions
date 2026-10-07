#!/bin/bash

set -e

echo "======================================"
echo " DANIJACE PROMOTIONS Git Push"
echo "======================================"

echo ""
echo "Adding changes..."
git add .

echo ""
echo "Current changes:"
git status --short

echo ""
read -p "Enter commit message: " MESSAGE

if [ -z "$MESSAGE" ]; then
    echo "❌ Commit message cannot be empty."
    exit 1
fi

echo ""
echo "Committing..."
git commit -m "$MESSAGE"

echo ""
echo "Pushing to remote..."
git push

echo ""
echo "======================================"
echo "✅ Git push completed successfully."
echo "======================================"
