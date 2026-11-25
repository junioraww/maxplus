<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { invoke } from "@tauri-apps/api/core";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import SettingsSection from "$components/settings/SettingsSection.svelte";
  import SettingsRow from "$components/settings/SettingsRow.svelte";
  import { clientSettings, initClientSettings, updateClientSetting } from "$lib/stores/clientSettings";
  import { currentRealChats } from "$lib/stores/api";
  import { getCurrentAccount } from "$lib/stores/accounts";
  import { resetImageCaches } from "$lib/utils/images";
  import { clearAllSafeAvatarCaches } from "$lib/services/AvatarSyncManager";
  import { showConfirm } from "$lib/stores/session";
  import { showAlert } from "$lib/utils/alert";

  export let isTab = false;
  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let clearing = false;

  onMount(() => {
    initClientSettings();
  });

  async function clearMediaCache() {
    if (clearing) return;
    const ok = await showConfirm({
      title: "Очистить кэш?",
      message: "Временные файлы и кешированные медиаданные будут удалены. Переписки останутся в облаке.",
      confirmText: "Очистить",
      cancelText: "Отмена",
      confirmDanger: true,
    });
    if (!ok) return;

    clearing = true;
    try {
      const account = await getCurrentAccount().catch(() => null);
      const accountId = Number(account?.id || 0);
      if (accountId > 0) {
        await invoke("delete_safe_avatars_cache", { account: accountId }).catch(() => {});
        const chatIds = $currentRealChats || [];
        await Promise.all(
          chatIds.map((chatId) =>
            invoke("delete_chat_cache", {
              account: accountId,
              chatId: Number(chatId),
              mediaType: null,
            }).catch(() => {})
          )
        );
      }
      resetImageCaches();
      await clearAllSafeAvatarCaches().catch(() => {});
      if (typeof caches !== "undefined") {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
      showAlert("Кэш очищен");
    } catch (e) {
      console.error(e);
      showAlert("Не удалось очистить кэш");
    } finally {
      clearing = false;
    }
  }
</script>

<SettingsPageWrapper title="Медиа и память" {from} {isTab} {onClose}>
  <div class="media-page">
    <SettingsSection title="Автозагрузка медиа">
      <SettingsRow
        title="Фотографии"
        isToggle={true}
        checked={$clientSettings.autoDownloadPhotos}
        on:change={(e) => updateClientSetting("autoDownloadPhotos", e.detail.checked)}
      />
      <SettingsRow
        title="Видео"
        isToggle={true}
        checked={$clientSettings.autoDownloadVideos}
        on:change={(e) => updateClientSetting("autoDownloadVideos", e.detail.checked)}
      />
      <SettingsRow
        title="Файлы"
        isToggle={true}
        checked={$clientSettings.autoDownloadFiles}
        on:change={(e) => updateClientSetting("autoDownloadFiles", e.detail.checked)}
      />
    </SettingsSection>

    <SettingsSection title="Воспроизведение и сохранение">
      <SettingsRow
        title="Автовоспроизведение GIF"
        isToggle={true}
        checked={$clientSettings.autoPlayGifs}
        on:change={(e) => updateClientSetting("autoPlayGifs", e.detail.checked)}
      />
      <SettingsRow
        title="Автовоспроизведение видео"
        isToggle={true}
        checked={$clientSettings.autoPlayVideos}
        on:change={(e) => updateClientSetting("autoPlayVideos", e.detail.checked)}
      />
      <SettingsRow
        title="Сохранять в галерею"
        subtitle="Автоматически сохранять загруженные фото и видео"
        isToggle={true}
        checked={$clientSettings.saveToGallery}
        on:change={(e) => updateClientSetting("saveToGallery", e.detail.checked)}
      />
    </SettingsSection>

    <SettingsSection title="Память">
      <SettingsRow
        title={clearing ? "Очистка..." : "Очистить кэш"}
        subtitle="Удалить временные медиафайлы с устройства"
        danger={true}
        chevron={false}
        disabled={clearing}
        on:click={clearMediaCache}
      />
    </SettingsSection>
  </div>
</SettingsPageWrapper>

<style>
  .media-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 12px 24px;
  }
</style>
