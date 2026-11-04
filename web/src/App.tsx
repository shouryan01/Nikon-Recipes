import { useEffect, useState } from 'react'
import type { RecipeItem, PictureControlSettings } from './types/recipe'
import recipesData from './data/recipes.json'
import { Header } from './components/Header'
import { RecipeCatalog } from './components/RecipeCatalog'
import { PreviewViewport } from './components/PreviewViewport'
import { CullStudio } from './components/CullStudio'
import { ChatPanel } from './components/ChatPanel'
import { RecipeInspector } from './components/RecipeInspector'
import { TooltipProvider } from './components/ui/tooltip'
import { Toaster } from './components/ui/sonner'
import { deserialize } from 'nikon-flexible-color-picture-control'

export default function App() {
  const [recipes, setRecipes] = useState<RecipeItem[]>(recipesData as RecipeItem[])
  const [activeRecipe, setActiveRecipe] = useState<RecipeItem>(recipesData[0] as RecipeItem)
  const [activeSettings, setActiveSettings] = useState<PictureControlSettings>(
    recipesData[0].settings as PictureControlSettings
  )
  const [currentImageSrc, setCurrentImageSrc] = useState<string | null>('/samples/portrait.jpg')
  const [mode, setMode] = useState<'discover' | 'cull'>('discover')
  const [favorites, setFavorites] = useState<RecipeItem[]>(() => {
    try {
      const raw = localStorage.getItem('nef:favorites')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.id === 'string') : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('nef:favorites', JSON.stringify(favorites))
    } catch {
      /* private mode: favorites just won't persist */
    }
  }, [favorites])

  useEffect(() => {
    return () => {
      if (currentImageSrc?.startsWith('blob:')) URL.revokeObjectURL(currentImageSrc)
    }
  }, [currentImageSrc])
  const [viewMode, setViewMode] = useState<'split' | 'toggle' | 'side-by-side'>('split')
  const [isHoldingCompare, setIsHoldingCompare] = useState<boolean>(false)

  const handleSelectRecipe = (recipe: RecipeItem) => {
    setActiveRecipe(recipe)
    setActiveSettings(JSON.parse(JSON.stringify(recipe.settings)))
  }

  const toggleFavorite = (recipe: RecipeItem) => {
    setFavorites((prev) => (prev.some((r) => r.id === recipe.id) ? prev.filter((r) => r.id !== recipe.id) : [...prev, recipe]))
  }

  const handleCustomRecipeLoaded = (recipe: RecipeItem) => {
    setRecipes((prev) => [recipe, ...prev])
    setActiveRecipe(recipe)
    setActiveSettings(JSON.parse(JSON.stringify(recipe.settings)))
  }

  const handleMakeFilter = (name: string, settings: PictureControlSettings) => {
    const item: RecipeItem = {
      id: `taste_${Date.now()}`,
      name,
      category: 'Taste Blends',
      creator: 'Muse Spark + you',
      path: name,
      settings,
    }
    setRecipes((prev) => [item, ...prev])
    setActiveRecipe(item)
    setActiveSettings(JSON.parse(JSON.stringify(settings)))
    setMode('discover')
  }

  const handleRecipeFileDropped = async (file: File) => {
    try {
      const buffer = new Uint8Array(await file.arrayBuffer())
      const settings = deserialize(buffer) as PictureControlSettings
      if (buffer[52] === 0x06) {
        settings.saturation = -100
      }
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
        <Header
          viewMode={viewMode}
          onViewModeChange={mode === 'discover' ? setViewMode : undefined}
          isHoldingCompare={mode === 'discover' ? isHoldingCompare : undefined}
          onHoldCompareChange={mode === 'discover' ? setIsHoldingCompare : undefined}
        />
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
          <button
            onClick={() => setMode('discover')}
            className={`px-3 py-1 text-xs rounded-md font-semibold ${mode === 'discover' ? 'bg-[#FFE100] text-black' : 'text-neutral-500'}`}
          >
            Discover
          </button>
          <button
            onClick={() => setMode('cull')}
            className={`px-3 py-1 text-xs rounded-md font-semibold ${mode === 'cull' ? 'bg-[#FFE100] text-black' : 'text-neutral-500'}`}
          >
            Cull
          </button>
          <span className="ml-2 text-[11px] text-neutral-500">{favorites.length} favorites</span>
        </div>

        <Toaster position="top-center" />

        <div className="flex-1 flex overflow-hidden">
          {mode === 'discover' ? (
            <>
              <RecipeCatalog
                recipes={recipes}
                activeRecipeId={activeRecipe.id}
                favoriteIds={favorites.map((r) => r.id)}
                onToggleFavorite={toggleFavorite}
                onSelectRecipe={handleSelectRecipe}
                onCustomRecipeLoaded={handleCustomRecipeLoaded}
                onImageChanged={setCurrentImageSrc}
              />
              <PreviewViewport
                currentImageSrc={currentImageSrc}
                recipeSettings={activeSettings}
                onImageChanged={setCurrentImageSrc}
                onRecipeDropped={handleRecipeFileDropped}
                viewMode={viewMode}
                isHoldingCompare={isHoldingCompare}
                setIsHoldingCompare={setIsHoldingCompare}
              />
              <RecipeInspector
                recipe={activeRecipe}
                settings={activeSettings}
                onUpdateSettings={setActiveSettings}
                onResetSettings={() => setActiveSettings(JSON.parse(JSON.stringify(activeRecipe.settings)))}
              />
            </>
          ) : (
            <CullStudio onToggleFavorite={toggleFavorite} favorites={favorites} activeRecipe={activeRecipe} />
          )}
          {mode === 'discover' && (
            <ChatPanel
              settings={activeSettings}
              recipeName={activeRecipe.name}
              photoName={currentImageSrc?.startsWith('blob:') ? 'uploaded photo' : (currentImageSrc?.split('/').pop() ?? 'no photo')}
              onApplyPatch={(patch) => setActiveSettings((prev) => ({ ...prev, ...patch }))}
              favorites={favorites}
              onMakeFilter={handleMakeFilter}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
