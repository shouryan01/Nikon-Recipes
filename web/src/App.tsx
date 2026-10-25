import { useState } from 'react'
import type { RecipeItem, PictureControlSettings } from './types/recipe'
import recipesData from './data/recipes.json'
import { Header } from './components/Header'
import { RecipeCatalog } from './components/RecipeCatalog'
import { PreviewViewport } from './components/PreviewViewport'
import { TooltipProvider } from './components/ui/tooltip'
import { deserialize } from 'nikon-flexible-color-picture-control'

export default function App() {
  const [recipes, setRecipes] = useState<RecipeItem[]>(recipesData as RecipeItem[])
  const [activeRecipe, setActiveRecipe] = useState<RecipeItem>(recipesData[0] as RecipeItem)
  const [activeSettings, setActiveSettings] = useState<PictureControlSettings>(
    recipesData[0].settings as PictureControlSettings
  )
  const [currentImageSrc, setCurrentImageSrc] = useState<string | null>('/samples/portrait.jpg')
  const [viewMode, setViewMode] = useState<'split' | 'toggle' | 'side-by-side'>('split')
  const [isHoldingCompare, setIsHoldingCompare] = useState<boolean>(false)

  // When a user selects a recipe from catalog
  const handleSelectRecipe = (recipe: RecipeItem) => {
    setActiveRecipe(recipe)
    setActiveSettings(JSON.parse(JSON.stringify(recipe.settings)))
  }

  // When a user drops or imports a custom .NP3 file
  const handleCustomRecipeLoaded = (recipe: RecipeItem) => {
    setRecipes((prev) => [recipe, ...prev])
    setActiveRecipe(recipe)
    setActiveSettings(JSON.parse(JSON.stringify(recipe.settings)))
  }

  const handleRecipeFileDropped = async (file: File) => {
    try {
      const buffer = new Uint8Array(await file.arrayBuffer())
      const settings = deserialize(buffer) as PictureControlSettings
      const customItem: RecipeItem = {
        id: `custom_${Date.now()}`,
        name: settings.name || file.name.replace(/\.np3$/i, ''),
        category: 'Custom Uploads',
        creator: 'User',
        path: file.name,
        settings,
      }
      handleCustomRecipeLoaded(customItem)
    } catch (err) {
      alert('Failed to parse .NP3 file: ' + err)
    }
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans">
        {/* Top Header */}
        <Header
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          isHoldingCompare={isHoldingCompare}
          onHoldCompareChange={setIsHoldingCompare}
        />

        {/* Main 2-Column Studio Interface */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Recipe Library */}
          <RecipeCatalog
            recipes={recipes}
            activeRecipeId={activeRecipe.id}
            onSelectRecipe={handleSelectRecipe}
            onCustomRecipeLoaded={handleCustomRecipeLoaded}
            onImageChanged={setCurrentImageSrc}
          />

          {/* Center: Live Photo Preview & Compare Viewport */}
          <PreviewViewport
            currentImageSrc={currentImageSrc}
            recipeSettings={activeSettings}
            onImageChanged={setCurrentImageSrc}
            onRecipeDropped={handleRecipeFileDropped}
            viewMode={viewMode}
            isHoldingCompare={isHoldingCompare}
            setIsHoldingCompare={setIsHoldingCompare}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}
